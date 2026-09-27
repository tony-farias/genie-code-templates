from __future__ import annotations

from typing import Any

from databricks.sdk import WorkspaceClient

from .config import load_config


def _extract_table(
    client: WorkspaceClient,
    space_id: str,
    conversation_id: str,
    message_id: str,
) -> dict[str, Any] | None:
    try:
        response = client.genie.get_message_query_result(space_id, conversation_id, message_id)
    except Exception:
        return None
    statement = getattr(response, "statement_response", None)
    if not statement or not statement.manifest:
        return None
    columns = [column.name for column in statement.manifest.schema.columns]
    rows = (statement.result.data_array if statement.result else None) or []
    if not rows and statement.statement_id:
        try:
            fallback = client.statement_execution.get_statement(statement.statement_id)
            rows = (fallback.result.data_array if fallback.result else None) or []
        except Exception:
            rows = []
    return {"columns": columns, "rows": rows[:100]} if rows else None


def ask(
    client: WorkspaceClient,
    message: str,
    conversation_id: str | None = None,
) -> dict[str, Any]:
    space_id = str(load_config().get("genie_space_id") or load_config().get("genie_agent_id") or "")
    if not space_id:
        raise RuntimeError("No Genie Space is configured")
    result = (
        client.genie.create_message_and_wait(space_id, conversation_id, message)
        if conversation_id
        else client.genie.start_conversation_and_wait(space_id, message)
    )
    text: list[str] = []
    table = None
    for attachment in result.attachments or []:
        if getattr(attachment, "text", None) and attachment.text.content:
            text.append(attachment.text.content)
        if getattr(attachment, "query", None):
            query = attachment.query
            if getattr(query, "description", None):
                text.append(query.description)
            if table is None:
                table = _extract_table(client, space_id, result.conversation_id, result.id)
    if not text and getattr(result, "content", None):
        text.append(result.content)
    return {
        "conversation_id": result.conversation_id,
        "message_id": result.id,
        "text": "\n\n".join(text) or "No response was returned.",
        "table": table,
    }
