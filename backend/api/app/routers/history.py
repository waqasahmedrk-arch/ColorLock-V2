"""The signed-in user's own score history: list, export, delete one, clear all."""

from __future__ import annotations

import csv
import io
import json
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy import case, delete, func, select
from sqlalchemy.orm import Session

from ..db.auth import ScoreRecord, User, get_auth_db
from ..errors import ProblemError
from ..services import xlsx_export
from ..services.notify import notify
from .auth import current_user
from .score import clean_name, name_taken

router = APIRouter(prefix="/history", tags=["history"])


class HistoryRecordOut(BaseModel):
    id: str
    score_id: str
    created_at: datetime
    filename: str | None
    name: str | None
    result: dict[str, Any]


class HistoryStats(BaseModel):
    count: int
    qc_pass_count: int
    best_delta_e00: float | None
    mean_delta_e00: float | None


class HistoryPage(BaseModel):
    items: list[HistoryRecordOut]
    total: int
    offset: int
    limit: int
    stats: HistoryStats


def _out(r: ScoreRecord) -> HistoryRecordOut:
    # Stored as naive UTC (MySQL DATETIME); say so, so browsers show local time correctly.
    return HistoryRecordOut(id=r.id, score_id=r.score_id, filename=r.filename, name=r.name,
                            created_at=r.created_at.replace(tzinfo=UTC), result=r.result)


def _like(text: str) -> str:
    # The search is a plain substring match: % and _ in it mean themselves.
    return "%" + text.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _naive_utc(dt: datetime) -> datetime:
    # Stored datetimes are naive UTC; a bound without a zone is taken as UTC already.
    return dt.astimezone(UTC).replace(tzinfo=None) if dt.tzinfo else dt


@router.get("", response_model=HistoryPage)
def list_history(offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100),
                 q: str | None = Query(None, max_length=100),
                 since: datetime | None = None, until: datetime | None = None,
                 user: User = Depends(current_user),
                 db: Session = Depends(get_auth_db)) -> HistoryPage:
    """`q` filters by score name (case-insensitive substring); `since` (inclusive) and
    `until` (exclusive) by when it was scored. The client sends the user's local day
    boundaries with their zone offset. `total` counts the matches, while `stats` always
    describe the whole history."""
    mine = ScoreRecord.user_id == user.id
    where = [mine]
    term = " ".join((q or "").split())
    if term:
        where.append(func.lower(ScoreRecord.name).like(_like(term), escape="\\"))
    if since is not None:
        where.append(ScoreRecord.created_at >= _naive_utc(since))
    if until is not None:
        where.append(ScoreRecord.created_at < _naive_utc(until))
    rows = db.scalars(select(ScoreRecord).where(*where)
                      .order_by(ScoreRecord.created_at.desc(), ScoreRecord.id)
                      .offset(offset).limit(limit)).all()
    total = db.scalar(select(func.count(ScoreRecord.id)).where(*where)) or 0
    count, passed, best, mean = db.execute(select(
        func.count(ScoreRecord.id),
        func.sum(case((ScoreRecord.qc_pass, 1), else_=0)),
        func.min(ScoreRecord.delta_e00),
        func.avg(ScoreRecord.delta_e00),
    ).where(mine)).one()
    return HistoryPage(
        items=[_out(r) for r in rows], total=total, offset=offset, limit=limit,
        stats=HistoryStats(
            count=count, qc_pass_count=int(passed or 0),
            best_delta_e00=float(best) if best is not None else None,
            mean_delta_e00=float(mean) if mean is not None else None,
        ),
    )


class NameCheck(BaseModel):
    name: str
    available: bool


# Lets the Score page tell the user a name is taken before they upload anything.
@router.get("/name-available", response_model=NameCheck)
def name_available(name: str = Query(..., max_length=200), user: User = Depends(current_user),
                   db: Session = Depends(get_auth_db)) -> NameCheck:
    clean = clean_name(name)
    return NameCheck(name=clean, available=not name_taken(db, user, clean))


EXPORT_COLUMNS = ["created_at", "name", "filename", "target_id", "target_name", "target_hex",
                  "sample_hex", "delta_e00", "qc_pass"]


def _cell(text: str) -> str:
    # A leading = + - @ would run as a formula when the CSV is opened in a spreadsheet.
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


@router.get("/export")
def export_history(format: Literal["csv", "json", "xlsx"] = "csv",
                   user: User = Depends(current_user),
                   db: Session = Depends(get_auth_db)) -> Response:
    rows = db.scalars(select(ScoreRecord).where(ScoreRecord.user_id == user.id)
                      .order_by(ScoreRecord.created_at.desc(), ScoreRecord.id)).all()
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    body: str | bytes
    if format == "xlsx":
        # Every measured value, typed, plus an "About" sheet describing the columns.
        body, media = xlsx_export.build(rows, user), xlsx_export.MEDIA_TYPE
    elif format == "json":
        body = json.dumps([_out(r).model_dump(mode="json") for r in rows], ensure_ascii=False,
                          indent=2)
        media = "application/json"
    else:
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(EXPORT_COLUMNS)
        for r in rows:
            w.writerow([r.created_at.replace(tzinfo=UTC).isoformat(), _cell(r.name or ""),
                        _cell(r.filename or ""),
                        r.target_id or "", r.target_name, r.target_hex, r.sample_hex,
                        f"{r.delta_e00:.4f}", "yes" if r.qc_pass else "no"])
        body, media = buf.getvalue(), "text/csv; charset=utf-8"
    return Response(body, media_type=media, headers={
        "Content-Disposition": f'attachment; filename="colorlock-history-{stamp}.{format}"'})


@router.delete("/{record_id}", status_code=204)
def delete_record(record_id: str, user: User = Depends(current_user),
                  db: Session = Depends(get_auth_db)) -> None:
    row = db.get(ScoreRecord, record_id)
    # Someone else's record looks exactly like a missing one.
    if row is None or row.user_id != user.id:
        raise ProblemError(404, "Record not found")
    db.delete(row)
    db.commit()


@router.delete("", status_code=204)
def clear_history(user: User = Depends(current_user),
                  db: Session = Depends(get_auth_db)) -> None:
    count = db.execute(delete(ScoreRecord).where(ScoreRecord.user_id == user.id)).rowcount
    if count:
        notify(db, user, "history_cleared", {"count": count}, link="/history")
    db.commit()


# Declared last so /export and /name-available aren't read as record ids.
@router.get("/{record_id}", response_model=HistoryRecordOut)
def get_record(record_id: str, user: User = Depends(current_user),
               db: Session = Depends(get_auth_db)) -> HistoryRecordOut:
    """One saved score, for its printable report."""
    row = db.get(ScoreRecord, record_id)
    # Someone else's record looks exactly like a missing one.
    if row is None or row.user_id != user.id:
        raise ProblemError(404, "Record not found")
    return _out(row)
