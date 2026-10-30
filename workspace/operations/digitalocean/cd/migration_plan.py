"""Run inside the candidate image; print only revision metadata, never DSNs."""
import json
import os


def plan(script, current):
    heads = script.get_heads()
    if len(heads) != 1 or len(current) != 1:
        raise RuntimeError('Automatic deployment requires a single current and target revision')
    pending = list(script.iterate_revisions(heads[0], current[0]))
    unsafe = [r.revision for r in pending
              if getattr(r.module, 'deployment_backward_compatible', False) is not True]
    if unsafe:
        raise RuntimeError('New migrations must explicitly declare deployment_backward_compatible = True')
    return {'current': current[0], 'target': heads[0],
            'pending': [r.revision for r in reversed(pending)]}


def main():
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from alembic.runtime.migration import MigrationContext
    from sqlalchemy import create_engine
    script = ScriptDirectory.from_config(Config('/app/alembic.ini'))
    engine = create_engine(os.environ['DATABASE_URL'])
    try:
        with engine.connect() as connection:
            current = MigrationContext.configure(connection).get_current_heads()
        print(json.dumps(plan(script, current)))
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
