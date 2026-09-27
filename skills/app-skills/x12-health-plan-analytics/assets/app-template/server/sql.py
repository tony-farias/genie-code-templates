from __future__ import annotations

import time
from typing import Any

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementParameterListItem

from .config import load_config


def execute(
    client: WorkspaceClient,
    statement: str,
    parameters: dict[str, str] | None = None,
    *,
    timeout_seconds: int = 55,
) -> list[dict[str, Any]]:
    response = client.statement_execution.execute_statement(
        warehouse_id=str(load_config()["warehouse_id"]),
        statement=statement,
        wait_timeout="10s",
        parameters=(
            [StatementParameterListItem(name=name, value=value) for name, value in parameters.items()]
            if parameters
            else None
        ),
    )
    deadline = time.monotonic() + timeout_seconds
    while response.status and str(response.status.state).upper().endswith(("PENDING", "RUNNING")):
        if time.monotonic() >= deadline:
            client.statement_execution.cancel_execution(response.statement_id)
            raise TimeoutError("Analytics query timed out")
        time.sleep(0.5)
        response = client.statement_execution.get_statement(response.statement_id)

    state = str(response.status.state) if response.status and response.status.state else "UNKNOWN"
    if "SUCCEEDED" not in state:
        message = response.status.error.message if response.status and response.status.error else state
        raise RuntimeError(f"Analytics query failed: {message}")
    if not response.manifest or not response.manifest.schema:
        return []
    columns = [column.name for column in response.manifest.schema.columns]
    rows = response.result.data_array if response.result and response.result.data_array else []
    return [dict(zip(columns, row)) for row in rows]


def as_int(value: Any) -> int:
    return int(value or 0)


def as_float(value: Any) -> float:
    return float(value or 0)
