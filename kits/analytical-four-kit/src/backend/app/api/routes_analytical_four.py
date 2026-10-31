"""Analytical-Four routes (docs/analytical-four-kit.md, section 4).

Who may call which route is decided by the shared entry-permission middleware and permissions/entry_points.json, which is
assembled from kit.contract.json. These routes trust only the actor that middleware sets on the request and answer 401
without it. Nothing here touches the database: settings, runs and results live as files in the Kit data directory.
"""
from functools import lru_cache
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import ValidationError

from app.analytical_four.feedback import FeedbackError, FeedbackStore
from app.analytical_four.runs import RunError, RunStore, problems_as_json
from app.analytical_four.seed_demo import seed
from app.analytical_four.settings import Settings, SettingsError, data_dir, load_settings, readiness, save_settings

router = APIRouter()


def actor_id(request: Request) -> str:
    user_id = getattr(request.state, 'actor_user_id', None)
    if not user_id:
        raise HTTPException(401, 'Unauthorized')  # the middleware did not run: refuse rather than guess
    return str(user_id)


@lru_cache(maxsize=4)
def _store(root: str) -> RunStore:
    return RunStore(Path(root))


def store() -> RunStore:
    return _store(str(data_dir()))  # keyed by directory so one process keeps one run lock per data directory


@lru_cache(maxsize=4)
def _feedback(root: str) -> FeedbackStore:
    return FeedbackStore(Path(root), store())


def feedback() -> FeedbackStore:
    return _feedback(str(data_dir()))


def actor_role(request: Request) -> str:
    role = getattr(request.state, 'actor_role', None)
    if not isinstance(role, str) or not role:
        raise HTTPException(401, 'Unauthorized')
    return role


def refused(error: FeedbackError) -> HTTPException:
    return HTTPException(error.status, error.message)


MAX_BODY_BYTES = 5_000_000


def settings_or_422() -> Settings:
    try:
        return load_settings()
    except SettingsError as error:
        raise HTTPException(422, str(error)) from error


def failing(error: RunError) -> HTTPException:
    return HTTPException(error.status, error.message)


@router.get('/api/analytical-four/settings')
def get_settings(request: Request):
    actor_id(request)
    return settings_or_422().model_dump()


@router.put('/api/analytical-four/settings')
def put_settings(body: dict, request: Request):
    actor_id(request)
    try:
        settings = Settings.model_validate(body)
    except ValidationError as error:
        raise HTTPException(422, [{'field': '.'.join(map(str, e['loc'])), 'message': e['msg']} for e in error.errors()]) from error
    save_settings(settings)
    return {'settings': settings.model_dump(), 'readiness': problems_as_json(readiness(settings))}


@router.get('/api/analytical-four/status')
def get_status(request: Request):
    actor_id(request)
    settings = settings_or_422()
    return {'enabledLayers': settings.enabled(), 'mode': settings.mode, 'llmEndpointSet': bool(settings.llm.endpoint),
            'activeRun': store().active, 'readiness': problems_as_json(readiness(settings))}


@router.post('/api/analytical-four/demo', status_code=201)
def load_demo(request: Request):
    actor_id(request)
    return {'copied': seed()}


@router.post('/api/analytical-four/runs', status_code=202)
def create_run(request: Request):
    who = actor_id(request)
    try:
        return store().create(settings_or_422(), who)
    except RunError as error:
        raise failing(error) from error


@router.get('/api/analytical-four/runs')
def list_runs(request: Request, limit: int = Query(50, ge=1, le=200)):
    actor_id(request)
    return {'runs': store().list(limit)}


@router.get('/api/analytical-four/runs/{run_id}')
def get_run(run_id: str, request: Request):
    actor_id(request)
    try:
        return store().get(run_id)
    except RunError as error:
        raise failing(error) from error


@router.get('/api/analytical-four/runs/{run_id}/results')
def list_results(run_id: str, request: Request):
    actor_id(request)
    try:
        store().get(run_id)
        return {'runId': run_id, 'results': store().result_names(run_id)}
    except RunError as error:
        raise failing(error) from error


@router.get('/api/analytical-four/runs/{run_id}/result')
def get_result(run_id: str, request: Request, name: str = Query(..., min_length=1, max_length=300)):
    actor_id(request)
    try:
        store().get(run_id)
        return store().result(run_id, name)
    except RunError as error:
        raise failing(error) from error


@router.post('/api/analytical-four/feedback', status_code=201)
def submit_feedback(body: dict, request: Request):
    who, role = actor_id(request), actor_role(request)
    try:
        return feedback().submit_from_run(settings_or_422(), str(body.get('runId', '')), str(body.get('eventId', '')),
                                          body.get('confirmedNg'), body.get('actualCause'), body.get('note'), who, role)
    except FeedbackError as error:
        raise refused(error) from error


@router.post('/api/analytical-four/feedback/import', status_code=201)
def import_feedback(body: dict, request: Request):
    who, role = actor_id(request), actor_role(request)
    if int(request.headers.get('content-length') or 0) > MAX_BODY_BYTES:
        raise HTTPException(413, f'一次匯入最多 {MAX_BODY_BYTES} 位元組')
    try:
        return {'feedback': feedback().import_records(settings_or_422(), body.get('records'), who, role)}
    except FeedbackError as error:
        raise refused(error) from error


@router.get('/api/analytical-four/feedback')
def list_feedback(request: Request, status: str = Query('', pattern='^(pending|approved|rejected)?$'), limit: int = Query(100, ge=1, le=500)):
    actor_id(request)
    try:
        return {'feedback': feedback().list(status or None, limit)}
    except FeedbackError as error:
        raise refused(error) from error


@router.post('/api/analytical-four/feedback/{feedback_id}/decision')
def decide_feedback(feedback_id: str, body: dict, request: Request):
    who, role = actor_id(request), actor_role(request)
    try:
        return feedback().decide(feedback_id, body.get('approve'), body.get('note'), who, role)
    except FeedbackError as error:
        raise refused(error) from error


@router.post('/api/analytical-four/library/publish', status_code=201)
def publish_library(request: Request):
    who = actor_id(request)
    try:
        return feedback().publish(settings_or_422(), who)
    except FeedbackError as error:
        raise refused(error) from error


@router.get('/api/analytical-four/library/versions')
def library_versions(request: Request):
    actor_id(request)
    try:
        return {'versions': feedback().versions()}
    except FeedbackError as error:
        raise refused(error) from error
