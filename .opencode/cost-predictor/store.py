#!/usr/bin/env python3
"""SQLite trace store for the project-local OpenCode cost predictor plugin."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

OUTCOMES = {"success", "partial", "failed", "abandoned"}
DB_NAME = "traces.sqlite"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


def data_dir() -> Path:
    override = os.environ.get("OPENCODE_COST_PREDICTOR_HOME")
    if override:
        return Path(override).expanduser()

    xdg = os.environ.get("XDG_DATA_HOME")
    if xdg:
        return Path(xdg).expanduser() / "opencode-cost-predictor"

    return Path.home() / ".local" / "share" / "opencode-cost-predictor"


def db_path() -> Path:
    return data_dir() / DB_NAME


def normalize_path(value: str | None) -> str | None:
    if not value:
        return value
    try:
        return str(Path(value).expanduser().resolve())
    except Exception:
        return str(Path(value).expanduser())


def connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    migrate(conn)
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS sessions (
          session_key TEXT PRIMARY KEY,
          session_id TEXT,
          project_dir TEXT NOT NULL,
          repo_root TEXT,
          git_remote TEXT,
          git_branch TEXT,
          git_head_sha TEXT,
          model TEXT,
          provider TEXT,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          event_count INTEGER NOT NULL DEFAULT 0,
          command_count INTEGER NOT NULL DEFAULT 0,
          tool_call_count INTEGER NOT NULL DEFAULT 0,
          raw_last_json TEXT
        );

        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_key TEXT NOT NULL,
          event_type TEXT NOT NULL,
          created_at TEXT NOT NULL,
          raw_json TEXT NOT NULL,
          FOREIGN KEY(session_key) REFERENCES sessions(session_key)
        );

        CREATE TABLE IF NOT EXISTS commands (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_key TEXT NOT NULL,
          command TEXT NOT NULL,
          trigger_type TEXT,
          created_at TEXT NOT NULL,
          raw_json TEXT NOT NULL,
          FOREIGN KEY(session_key) REFERENCES sessions(session_key)
        );

        CREATE TABLE IF NOT EXISTS files_touched (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_key TEXT NOT NULL,
          path TEXT NOT NULL,
          event_type TEXT,
          created_at TEXT NOT NULL,
          UNIQUE(session_key, path),
          FOREIGN KEY(session_key) REFERENCES sessions(session_key)
        );

        CREATE TABLE IF NOT EXISTS terminal_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_key TEXT NOT NULL,
          trigger_type TEXT NOT NULL,
          trigger_command TEXT,
          outcome TEXT NOT NULL,
          label_source TEXT NOT NULL,
          confidence REAL,
          created_at TEXT NOT NULL,
          labeled_at TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          FOREIGN KEY(session_key) REFERENCES sessions(session_key)
        );

        CREATE INDEX IF NOT EXISTS events_session_created_idx ON events(session_key, created_at);
        CREATE INDEX IF NOT EXISTS commands_session_created_idx ON commands(session_key, created_at);
        CREATE INDEX IF NOT EXISTS terminal_pending_idx
          ON terminal_records(outcome, label_source, created_at);
        """
    )
    conn.commit()


def run_git(project_dir: str, args: list[str]) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=project_dir,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            timeout=2,
        )
    except Exception:
        return None

    value = result.stdout.strip()
    return value or None


def git_metadata(project_dir: str) -> dict[str, str | None]:
    return {
        "repo_root": normalize_path(run_git(project_dir, ["rev-parse", "--show-toplevel"])),
        "git_remote": run_git(project_dir, ["config", "--get", "remote.origin.url"]),
        "git_branch": run_git(project_dir, ["branch", "--show-current"]),
        "git_head_sha": run_git(project_dir, ["rev-parse", "HEAD"]),
    }


def payload_arg(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    return json.loads(value)


def upsert_session(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    ts = payload.get("createdAt") or now_iso()
    project_dir = normalize_path(payload.get("projectDir") or os.getcwd()) or os.getcwd()
    payload["projectDir"] = project_dir
    session_key = payload["sessionKey"]
    git = git_metadata(project_dir)
    context = payload.get("context") or {}

    conn.execute(
        """
        INSERT INTO sessions (
          session_key, session_id, project_dir, repo_root, git_remote, git_branch,
          git_head_sha, model, provider, first_seen_at, last_seen_at, raw_last_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_key) DO UPDATE SET
          session_id=COALESCE(excluded.session_id, sessions.session_id),
          project_dir=excluded.project_dir,
          repo_root=excluded.repo_root,
          git_remote=excluded.git_remote,
          git_branch=excluded.git_branch,
          git_head_sha=excluded.git_head_sha,
          model=COALESCE(excluded.model, sessions.model),
          provider=COALESCE(excluded.provider, sessions.provider),
          last_seen_at=excluded.last_seen_at,
          raw_last_json=excluded.raw_last_json
        """,
        (
            session_key,
            payload.get("sessionId"),
            project_dir,
            git["repo_root"],
            git["git_remote"],
            git["git_branch"],
            git["git_head_sha"],
            context.get("model"),
            context.get("provider"),
            ts,
            ts,
            json.dumps(payload, separators=(",", ":")),
        ),
    )


def ingest_event(args: argparse.Namespace) -> None:
    payload = payload_arg(args.payload_json)
    payload.setdefault("projectDir", args.project_dir)
    payload.setdefault("createdAt", now_iso())

    with connect() as conn:
        upsert_session(conn, payload)
        conn.execute(
            "INSERT INTO events(session_key, event_type, created_at, raw_json) VALUES (?, ?, ?, ?)",
            (
                payload["sessionKey"],
                payload.get("eventType") or "unknown",
                payload["createdAt"],
                json.dumps(payload.get("raw") or payload, separators=(",", ":")),
            ),
        )
        conn.execute(
            "UPDATE sessions SET event_count=event_count+1, last_seen_at=? WHERE session_key=?",
            (payload["createdAt"], payload["sessionKey"]),
        )
        for path in payload.get("filesTouched") or []:
            conn.execute(
                """
                INSERT OR IGNORE INTO files_touched(session_key, path, event_type, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (payload["sessionKey"], str(path), payload.get("eventType"), payload["createdAt"]),
            )


def record_command(args: argparse.Namespace) -> None:
    payload = payload_arg(args.payload_json)
    payload.setdefault("projectDir", args.project_dir)
    payload.setdefault("createdAt", now_iso())

    with connect() as conn:
        upsert_session(conn, payload)
        conn.execute(
            """
            INSERT INTO commands(session_key, command, trigger_type, created_at, raw_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                payload["sessionKey"],
                payload["command"],
                payload.get("triggerType"),
                payload["createdAt"],
                json.dumps(payload, separators=(",", ":")),
            ),
        )
        conn.execute(
            "UPDATE sessions SET command_count=command_count+1, last_seen_at=? WHERE session_key=?",
            (payload["createdAt"], payload["sessionKey"]),
        )


def record_terminal(args: argparse.Namespace) -> None:
    payload = payload_arg(args.payload_json)
    payload.setdefault("projectDir", args.project_dir)
    payload.setdefault("createdAt", now_iso())

    with connect() as conn:
        upsert_session(conn, payload)
        existing = conn.execute(
            """
            SELECT id
            FROM terminal_records
            WHERE session_key=?
              AND trigger_type=?
              AND COALESCE(trigger_command, '')=COALESCE(?, '')
              AND outcome='awaiting_label'
              AND label_source='pending_user'
            ORDER BY id DESC
            LIMIT 1
            """,
            (payload["sessionKey"], payload["triggerType"], payload.get("triggerCommand")),
        ).fetchone()
        if existing:
            return
        conn.execute(
            """
            INSERT INTO terminal_records(
              session_key, trigger_type, trigger_command, outcome, label_source,
              confidence, created_at, metadata_json
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["sessionKey"],
                payload["triggerType"],
                payload.get("triggerCommand"),
                payload.get("outcome") or "awaiting_label",
                payload.get("labelSource") or "pending_user",
                payload.get("confidence"),
                payload["createdAt"],
                json.dumps(payload.get("metadata") or {}, separators=(",", ":")),
            ),
        )


def latest_pending(conn: sqlite3.Connection, project_dir: str | None, session_key: str | None) -> sqlite3.Row | None:
    where = ["tr.outcome='awaiting_label'", "tr.label_source='pending_user'"]
    params: list[Any] = []
    if project_dir:
        where.append("s.project_dir=?")
        params.append(normalize_path(project_dir))
    if session_key:
        where.append("tr.session_key=?")
        params.append(session_key)

    return conn.execute(
        f"""
        SELECT tr.*
        FROM terminal_records tr
        JOIN sessions s ON s.session_key = tr.session_key
        WHERE {' AND '.join(where)}
        ORDER BY tr.created_at DESC, tr.id DESC
        LIMIT 1
        """,
        params,
    ).fetchone()


def label(args: argparse.Namespace) -> None:
    outcome = args.outcome.lower()
    if outcome not in OUTCOMES:
        raise SystemExit(f"invalid outcome {args.outcome!r}; expected one of {sorted(OUTCOMES)}")

    with connect() as conn:
        record = latest_pending(conn, args.project_dir, args.session_key)
        if not record:
            raise SystemExit("no pending terminal record found")

        conn.execute(
            """
            UPDATE terminal_records
            SET outcome=?, label_source='user_confirmed', confidence=1.0, labeled_at=?
            WHERE id=?
            """,
            (outcome, now_iso(), record["id"]),
        )
        print(json.dumps({"labeled_record_id": record["id"], "session_key": record["session_key"], "outcome": outcome}))


def pending(args: argparse.Namespace) -> None:
    with connect() as conn:
        rows = conn.execute(
            """
            SELECT tr.id, tr.session_key, s.project_dir, tr.trigger_type, tr.trigger_command, tr.created_at
            FROM terminal_records tr
            JOIN sessions s ON s.session_key = tr.session_key
            WHERE tr.outcome='awaiting_label' AND tr.label_source='pending_user'
            ORDER BY tr.created_at DESC, tr.id DESC
            LIMIT ?
            """,
            (args.limit,),
        ).fetchall()
    print(json.dumps([dict(row) for row in rows], indent=2))


def show(args: argparse.Namespace) -> None:
    with connect() as conn:
        sessions = conn.execute(
            """
            SELECT session_key, project_dir, git_branch, git_head_sha, event_count,
                   command_count, first_seen_at, last_seen_at
            FROM sessions
            ORDER BY last_seen_at DESC
            LIMIT ?
            """,
            (args.limit,),
        ).fetchall()
        terminal = conn.execute(
            """
            SELECT id, session_key, trigger_type, outcome, label_source, created_at, labeled_at
            FROM terminal_records
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            (args.limit,),
        ).fetchall()
    print(json.dumps({"db_path": str(db_path()), "sessions": [dict(r) for r in sessions], "terminal_records": [dict(r) for r in terminal]}, indent=2))


def infer_outcome(trigger_type: str) -> tuple[str, float]:
    if trigger_type in {"git_commit", "github_pr_publish"}:
        return "partial", 0.5
    if trigger_type == "session_closure":
        return "abandoned", 0.4
    return "partial", 0.3


def infer_stale(args: argparse.Namespace) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=args.older_than_hours)
    updated: list[dict[str, Any]] = []

    with connect() as conn:
        rows = conn.execute(
            """
            SELECT id, session_key, trigger_type, created_at
            FROM terminal_records
            WHERE outcome='awaiting_label' AND label_source='pending_user'
            ORDER BY created_at ASC, id ASC
            """
        ).fetchall()

        for row in rows:
            try:
                created = parse_iso(row["created_at"])
            except ValueError:
                created = cutoff - timedelta(seconds=1)
            if created > cutoff:
                continue

            outcome, confidence = infer_outcome(row["trigger_type"])
            conn.execute(
                """
                UPDATE terminal_records
                SET outcome=?, label_source='inferred_no_user_response', confidence=?, labeled_at=?
                WHERE id=? AND outcome='awaiting_label' AND label_source='pending_user'
                """,
                (outcome, confidence, now_iso(), row["id"]),
            )
            updated.append(
                {
                    "id": row["id"],
                    "session_key": row["session_key"],
                    "trigger_type": row["trigger_type"],
                    "outcome": outcome,
                    "confidence": confidence,
                }
            )

    print(json.dumps({"updated": updated}, indent=2))


def path_cmd(_args: argparse.Namespace) -> None:
    print(db_path())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    for name, fn in [("ingest-event", ingest_event), ("record-command", record_command), ("record-terminal", record_terminal)]:
        child = sub.add_parser(name)
        child.add_argument("--project-dir", required=True)
        child.add_argument("--payload-json", required=True)
        child.set_defaults(func=fn)

    child = sub.add_parser("label")
    child.add_argument("--outcome", required=True, choices=sorted(OUTCOMES))
    child.add_argument("--project-dir")
    child.add_argument("--session-key")
    child.set_defaults(func=label)

    child = sub.add_parser("pending")
    child.add_argument("--limit", type=int, default=20)
    child.set_defaults(func=pending)

    child = sub.add_parser("show")
    child.add_argument("--limit", type=int, default=10)
    child.set_defaults(func=show)

    child = sub.add_parser("infer-stale")
    child.add_argument("--older-than-hours", type=float, default=24.0)
    child.set_defaults(func=infer_stale)

    child = sub.add_parser("path")
    child.set_defaults(func=path_cmd)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
