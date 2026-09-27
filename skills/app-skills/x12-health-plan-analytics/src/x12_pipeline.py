# Databricks notebook source
"""Pinned X12 Bronze, Silver, and Gold pipeline.

This task intentionally runs on classic compute because the upstream parser uses
Spark RDDs while materializing its nested JSON output. No payload values are
printed or returned from this notebook.
"""

# COMMAND ----------

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Iterable

from pyspark.sql import functions as F
from pyspark.sql import types as T

from databricksx12.hls.mapinarrow_functions import from_edi_exploded, get_exploded_schema


PARSER_COMMIT = "ac6d84d3f322310816a55a43569242afe295b4c5"
SKILL_VERSION = "0.2.0"


for name, default in (
    ("source_table", ""),
    ("payload_column", "edi_payload"),
    ("primary_key_column", "record_id"),
    ("target_catalog", ""),
    ("target_schema", ""),
    ("table_prefix", "x12_demo_"),
):
    dbutils.widgets.text(name, default)

source_table = dbutils.widgets.get("source_table")
payload_column = dbutils.widgets.get("payload_column")
primary_key_column = dbutils.widgets.get("primary_key_column")
target_catalog = dbutils.widgets.get("target_catalog")
target_schema = dbutils.widgets.get("target_schema")
table_prefix = dbutils.widgets.get("table_prefix")

if not all((source_table, payload_column, primary_key_column, target_catalog, target_schema)):
    raise ValueError("source_table, payload_column, primary_key_column, target_catalog, and target_schema are required")


def quote(value: str) -> str:
    return "`" + value.replace("`", "``") + "`"


def output_table(layer: str, name: str) -> str:
    return ".".join((quote(target_catalog), quote(target_schema), quote(f"{table_prefix}{layer}_{name}")))


spark.sql(f"CREATE SCHEMA IF NOT EXISTS {quote(target_catalog)}.{quote(target_schema)}")

# COMMAND ----------


SUPPORTED_VERSION_PREFIXES = ("00501",)


def _segment_terminator(payload: str) -> str:
    compact = payload.lstrip("\ufeff\r\n \t")
    if compact.startswith("ISA") and len(compact) > 105:
        candidate = compact[105]
        if not candidate.isalnum() and not candidate.isspace():
            return candidate
    return "~"


def _split_segments(payload: str) -> list[list[str]]:
    compact = payload.lstrip("\ufeff\r\n \t")
    if not compact:
        return []
    element_separator = compact[3] if compact.startswith("ISA") and len(compact) > 3 else "*"
    terminator = _segment_terminator(compact)
    return [
        segment.strip().split(element_separator)
        for segment in compact.replace("\r", "").replace("\n", "").split(terminator)
        if segment.strip()
    ]


def _first(segments: Iterable[list[str]], name: str):
    return next((segment for segment in segments if segment and segment[0] == name), None)


def validate_x12(payload: str | None):
    value = payload or ""
    segments = _split_segments(value)
    names = [segment[0] for segment in segments if segment]
    errors: list[str] = []
    is_x12 = bool(segments and names[0] == "ISA" and "ST" in names)
    if not is_x12:
        return False, False, [], None, ["not_x12"], hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()

    for required in ("ISA", "GS", "ST", "SE", "GE", "IEA"):
        if required not in names:
            errors.append(f"missing_{required.lower()}")
    isa, gs, ge, iea = (_first(segments, name) for name in ("ISA", "GS", "GE", "IEA"))
    version = gs[8] if gs and len(gs) > 8 else (isa[12] if isa and len(isa) > 12 else None)
    if version and not version.startswith(SUPPORTED_VERSION_PREFIXES):
        errors.append("unsupported_version")
    if isa and iea and len(isa) > 13 and len(iea) > 2 and isa[13] != iea[2]:
        errors.append("interchange_control_mismatch")
    if gs and ge and len(gs) > 6 and len(ge) > 2 and gs[6] != ge[2]:
        errors.append("group_control_mismatch")

    transaction_types: set[str] = set()
    for st_index in (index for index, segment in enumerate(segments) if segment[0] == "ST"):
        st = segments[st_index]
        if len(st) > 1:
            transaction_types.add(st[1])
        se_index = next((index for index in range(st_index + 1, len(segments)) if segments[index][0] == "SE"), None)
        if se_index is None:
            errors.append("missing_se_for_transaction")
            continue
        se = segments[se_index]
        if len(st) > 2 and len(se) > 2 and st[2] != se[2]:
            errors.append("transaction_control_mismatch")
        if len(se) > 1:
            try:
                if int(se[1]) != se_index - st_index + 1:
                    errors.append("segment_count_mismatch")
            except ValueError:
                errors.append("invalid_segment_count")
    errors = list(dict.fromkeys(errors))
    return True, not errors, sorted(transaction_types), version, errors, hashlib.sha256(value.encode("utf-8", errors="replace")).hexdigest()


classification_schema = T.StructType([
    T.StructField("is_x12", T.BooleanType(), False),
    T.StructField("valid", T.BooleanType(), False),
    T.StructField("transaction_types", T.ArrayType(T.StringType()), False),
    T.StructField("version", T.StringType(), True),
    T.StructField("errors", T.ArrayType(T.StringType()), False),
    T.StructField("payload_hash", T.StringType(), False),
])
validate_x12_udf = F.udf(validate_x12, classification_schema)

# COMMAND ----------

available_columns = set(spark.table(source_table).columns)
transaction_type_expr = (
    F.col("transaction_type").cast("string")
    if "transaction_type" in available_columns
    else F.lit(None).cast("string")
)
source = (
    spark.table(source_table)
    .select(
        F.col(primary_key_column).cast("string").alias("source_record_id"),
        F.col(payload_column).cast("string").alias("raw_payload"),
        transaction_type_expr.alias("declared_transaction_type"),
    )
    .withColumn("classification", validate_x12_udf("raw_payload"))
    .withColumn("payload_hash", F.col("classification.payload_hash"))
    .withColumn(
        "transaction_type",
        F.coalesce("declared_transaction_type", F.element_at("classification.transaction_types", 1)),
    )
)

bronze = source.select(
    F.lit(source_table).alias("source_table"),
    "source_record_id",
    "payload_hash",
    "transaction_type",
    F.col("classification.version").alias("detected_version"),
    F.current_timestamp().alias("ingested_at"),
    "raw_payload",
)
bronze.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("bronze", "raw_x12"))

precheck_quarantine = (
    source.filter(~F.col("classification.valid"))
    .select(
        "source_record_id",
        "payload_hash",
        "transaction_type",
        F.lit("structural_validation_failed").alias("error_code"),
        F.concat_ws(",", F.col("classification.errors")).alias("safe_error_details"),
        F.current_timestamp().alias("processed_at"),
    )
)

valid_input = (
    source.filter(F.col("classification.valid"))
    .select(F.col("source_record_id").alias("pk"), F.col("raw_payload").alias("value"))
    .repartition(8)
)
parsed_raw = valid_input.mapInArrow(from_edi_exploded, schema=get_exploded_schema())
valid_metadata = source.filter(F.col("classification.valid")).select(
    "source_record_id", "payload_hash", "transaction_type"
)
parsed_joined = parsed_raw.join(valid_metadata, parsed_raw.pk == valid_metadata.source_record_id, "left")
parsed = (
    parsed_joined
    .withColumn("parser_error_raw", F.get_json_object("edi_json", "$.error"))
    .withColumn(
        "parser_error_fingerprint",
        F.when(F.col("parser_error_raw").isNotNull(), F.sha2("parser_error_raw", 256)),
    )
    .withColumn(
        "parse_status",
        F.when(F.col("parser_error_raw").isNull(), F.lit("parsed")).otherwise(F.lit("quarantined")),
    )
    .withColumn(
        "parsed_json",
        F.when(F.col("parser_error_raw").isNull(), F.col("edi_json")).otherwise(
            F.to_json(F.struct(
                F.lit("parser_error").alias("error_code"),
                F.col("parser_error_fingerprint").alias("error_fingerprint"),
            ))
        ),
    )
    .select(
        "source_record_id",
        "payload_hash",
        "transaction_type",
        F.lit(PARSER_COMMIT).alias("parser_commit"),
        "parse_status",
        F.when(F.col("parser_error_raw").isNotNull(), F.lit("parser_error")).alias("parser_error_code"),
        "parser_error_fingerprint",
        "parsed_json",
        F.current_timestamp().alias("processed_at"),
    )
)
parsed.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("silver", "parsed_transactions"))

parser_quarantine = parsed.filter(F.col("parse_status") != "parsed").select(
    "source_record_id",
    "payload_hash",
    "transaction_type",
    F.col("parser_error_code").alias("error_code"),
    F.col("parser_error_fingerprint").alias("safe_error_details"),
    "processed_at",
)
quarantine = precheck_quarantine.unionByName(parser_quarantine)
quarantine.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("silver", "x12_quarantine"))

# COMMAND ----------

successful = parsed.filter(F.col("parse_status") == "parsed")
claim_header = successful.filter(F.col("transaction_type") == "837").select(
    "source_record_id",
    "payload_hash",
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].claim_header.claim_id").alias("claim_id"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].patient.subsciber_identifier").alias("member_id"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].patient.dob").alias("member_dob"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].patient.gender_cd").alias("member_gender"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].patient.state").alias("member_state"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].claim_header.claim_amount").cast("decimal(18,2)").alias("claim_amount"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].diagnosis.principal_dx_cd").alias("principal_diagnosis_code"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].providers.billing.npi").alias("provider_id"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].providers.billing.name").alias("provider_name"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].providers.billing.state").alias("provider_state"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].claim_lines").alias("claim_lines_json"),
)
claim_header.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("silver", "claim_header"))

line_schema = T.ArrayType(T.StructType([
    T.StructField("claim_line_number", T.StringType()),
    T.StructField("prcdr_cd", T.StringType()),
    T.StructField("prcdr_cd_type", T.StringType()),
    T.StructField("line_chrg_amt", T.StringType()),
    T.StructField("units", T.StringType()),
    T.StructField("service_dates", T.ArrayType(T.StructType([
        T.StructField("date", T.StringType()),
        T.StructField("date_cd", T.StringType()),
        T.StructField("date_format", T.StringType()),
    ]))),
]))
claim_line = (
    claim_header
    .withColumn("claim_line", F.explode_outer(F.from_json("claim_lines_json", line_schema)))
    .select(
        "source_record_id",
        "payload_hash",
        "claim_id",
        F.col("claim_line.claim_line_number").alias("line_number"),
        F.col("claim_line.prcdr_cd").alias("procedure_code"),
        F.col("claim_line.prcdr_cd_type").alias("procedure_code_type"),
        F.col("claim_line.line_chrg_amt").cast("decimal(18,2)").alias("line_amount"),
        F.col("claim_line.units").cast("decimal(18,3)").alias("units"),
        F.element_at(F.col("claim_line.service_dates.date"), 1).alias("service_date_raw"),
    )
)
claim_line.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("silver", "claim_line"))

remittance = successful.filter(F.col("transaction_type") == "835").select(
    "source_record_id",
    "payload_hash",
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].claim.claim_id").alias("claim_id"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].claim.patient_id").alias("member_id"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].claim.claim_status_cd").alias("claim_status_code"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].claim.claim_chrg_amt").cast("decimal(18,2)").alias("charged_amount"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].claim.claim_pay_amt").cast("decimal(18,2)").alias("paid_amount"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].claim.patient_pay_amt").cast("decimal(18,2)").alias("patient_amount"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].payment.payment_date").alias("payment_date_raw"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].payer.payer_name").alias("payer_name"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].payee.payee_npi").alias("payee_npi"),
)
remittance.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("silver", "remittance"))

coverage_schema = T.ArrayType(T.StructType([
    T.StructField("maintenance_type_code", T.StringType()),
    T.StructField("coverage_type_code", T.StringType()),
    T.StructField("plan_coverage_description", T.StringType()),
    T.StructField("coverage_level_code", T.StringType()),
    T.StructField("coverage_start_dt", T.StringType()),
    T.StructField("coverage_end_dt", T.StringType()),
]))
enrollment_base = successful.filter(F.col("transaction_type") == "834").select(
    "source_record_id",
    "payload_hash",
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].enrollment_member.member_id_code").alias("member_id"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].enrollment_member.member_dob").alias("member_dob"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].enrollment_member.member_gender").alias("member_gender"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].enrollment_member.address.state").alias("member_state"),
    F.get_json_object("parsed_json", "$.FunctionalGroup[0].Transactions[0].Claims[0].enrollment_member.health_coverage_elections").alias("coverage_json"),
)
enrollment = (
    enrollment_base
    .withColumn("coverage", F.explode_outer(F.from_json("coverage_json", coverage_schema)))
    .select(
        "source_record_id", "payload_hash", "member_id", "member_dob", "member_gender", "member_state",
        F.col("coverage.maintenance_type_code").alias("maintenance_type_code"),
        F.col("coverage.coverage_type_code").alias("coverage_type_code"),
        F.col("coverage.plan_coverage_description").alias("plan_description"),
        F.col("coverage.coverage_level_code").alias("coverage_level_code"),
        F.col("coverage.coverage_start_dt").alias("coverage_start_raw"),
        F.col("coverage.coverage_end_dt").alias("coverage_end_raw"),
    )
)
enrollment.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("silver", "enrollment"))

# COMMAND ----------

member_candidates = (
    claim_header.select("member_id", "member_dob", "member_gender", "member_state")
    .unionByName(enrollment.select("member_id", "member_dob", "member_gender", "member_state"))
    .filter(F.col("member_id").isNotNull())
)
members = member_candidates.groupBy("member_id").agg(
    F.first("member_dob", ignorenulls=True).alias("member_dob"),
    F.first("member_gender", ignorenulls=True).alias("gender_code"),
    F.first("member_state", ignorenulls=True).alias("state_code"),
).select(
    F.sha2("member_id", 256).alias("member_key"),
    F.substring("member_dob", 1, 4).cast("int").alias("birth_year"),
    "gender_code",
    "state_code",
)
members.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("gold", "members"))

providers = claim_header.filter(F.col("provider_id").isNotNull()).select(
    F.col("provider_id").alias("provider_key"), "provider_name", F.col("provider_state").alias("state_code")
).dropDuplicates(["provider_key"])
providers.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("gold", "providers"))

first_service = claim_line.groupBy("claim_id").agg(F.min("service_date_raw").alias("service_date_raw"))
claims = claim_header.join(first_service, "claim_id", "left").select(
    "claim_id",
    F.sha2("member_id", 256).alias("member_key"),
    F.col("provider_id").alias("provider_key"),
    "claim_amount",
    "principal_diagnosis_code",
    F.to_date("service_date_raw", "yyyyMMdd").alias("service_date"),
    F.sha2("source_record_id", 256).alias("source_record_key"),
)
claims.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("gold", "claims"))

gold_claim_lines = claim_line.select(
    "claim_id", "line_number", "procedure_code", "procedure_code_type", "line_amount", "units",
    F.to_date("service_date_raw", "yyyyMMdd").alias("service_date"),
    F.sha2("source_record_id", 256).alias("source_record_key"),
)
gold_claim_lines.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("gold", "claim_lines"))

payments = remittance.select(
    "claim_id", "claim_status_code", "charged_amount", "paid_amount", "patient_amount",
    F.to_date("payment_date_raw", "yyyyMMdd").alias("payment_date"), "payer_name", "payee_npi",
    F.sha2("source_record_id", 256).alias("source_record_key"),
)
payments.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("gold", "payments"))

gold_enrollments = enrollment.select(
    F.sha2("member_id", 256).alias("member_key"),
    "maintenance_type_code", "coverage_type_code", "plan_description", "coverage_level_code",
    F.to_date("coverage_start_raw", "yyyyMMdd").alias("coverage_start_date"),
    F.to_date("coverage_end_raw", "yyyyMMdd").alias("coverage_end_date"),
    F.sha2("source_record_id", 256).alias("source_record_key"),
)
gold_enrollments.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("gold", "enrollments"))

data_quality = (
    parsed.groupBy("transaction_type", "parse_status").count()
    .withColumnRenamed("parse_status", "status")
    .unionByName(
        precheck_quarantine.groupBy("transaction_type").count().withColumn("status", F.lit("quarantined")).select("transaction_type", "status", "count")
    )
    .groupBy("transaction_type", "status").agg(F.sum("count").alias("record_count"))
)
data_quality.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_table("gold", "data_quality"))

# COMMAND ----------

tables = {
    "bronze_raw_x12": output_table("bronze", "raw_x12"),
    "silver_parsed_transactions": output_table("silver", "parsed_transactions"),
    "silver_x12_quarantine": output_table("silver", "x12_quarantine"),
    "gold_members": output_table("gold", "members"),
    "gold_providers": output_table("gold", "providers"),
    "gold_claims": output_table("gold", "claims"),
    "gold_claim_lines": output_table("gold", "claim_lines"),
    "gold_payments": output_table("gold", "payments"),
    "gold_enrollments": output_table("gold", "enrollments"),
    "gold_data_quality": output_table("gold", "data_quality"),
}

for table in tables.values():
    spark.sql(
        f"ALTER TABLE {table} SET TBLPROPERTIES "
        f"('x12.skill.version'='{SKILL_VERSION}', 'x12.parser.commit'='{PARSER_COMMIT}')"
    )

summary = {name: spark.table(table).count() for name, table in tables.items()}
summary.update({"parser_commit": PARSER_COMMIT, "skill_version": SKILL_VERSION})
dbutils.notebook.exit(json.dumps(summary, sort_keys=True))
