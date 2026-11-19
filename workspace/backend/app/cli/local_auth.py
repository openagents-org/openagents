# -*- coding: utf-8 -*-
"""Manage local (email + password) accounts from the server's shell.

For self-hosted instances without email delivery, where "Forgot password"
cannot send anything:

    python -m app.cli.local_auth reset-password <email>
        Print a one-time reset link (valid 1 hour) to hand to the user.

    python -m app.cli.local_auth set-password <email>
        Set the password directly (prompted, or read from stdin when piped).
        Creates the account if the email has none — use it to bootstrap an
        admin on an invite-only instance.

Run inside the backend container (e.g. ``docker compose exec backend python
-m app.cli.local_auth ...``) so it sees the same DATABASE_URL and DATA_DIR as
the server.
"""

import argparse
import getpass
import sys

from app.config import config


def _session():
    from app.database import SessionLocal

    return SessionLocal()


def _cmd_reset_password(email: str) -> int:
    from app.services import local_auth as la

    secret_before = config.WORKSPACE_SESSION_SECRET
    la.ensure_session_secret()
    if not config.WORKSPACE_SESSION_SECRET:
        print("error: no WORKSPACE_SESSION_SECRET and local auth is disabled", file=sys.stderr)
        return 1
    db = _session()
    try:
        user = la.find_user(db, email)
        if user is None:
            print(f"error: no account for {email}", file=sys.stderr)
            return 1
        token = la.mint_reset_token(user, la.get_credential(db, user))
    finally:
        db.close()
    if not secret_before:
        import os
        if not os.path.exists(os.path.join(config.DATA_DIR or "/data", "session_secret")):
            print(
                "warning: the session secret could not be persisted, so the server will not "
                "accept this link. Run this inside the server container or set WORKSPACE_SESSION_SECRET.",
                file=sys.stderr,
            )
    print(la.reset_link(token))
    return 0


def _read_new_password() -> str:
    if sys.stdin.isatty():
        first = getpass.getpass("New password: ")
        second = getpass.getpass("Repeat new password: ")
        if first != second:
            raise SystemExit("error: passwords do not match")
        return first
    return sys.stdin.readline().rstrip("\r\n")


def _cmd_set_password(email: str) -> int:
    from app.access import get_or_create_user_by_email
    from app.services import local_auth as la

    password = _read_new_password()
    problem = la.password_problem(password)
    if problem:
        print(f"error: {problem}", file=sys.stderr)
        return 1
    db = _session()
    try:
        user = get_or_create_user_by_email(db, email)
        la.set_password(db, user, password)
        db.commit()
    finally:
        db.close()
    print(f"Password set for {email}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli.local_auth", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (
        ("reset-password", "print a one-time password reset link"),
        ("set-password", "set a password (prompted, or from stdin)"),
    ):
        p = sub.add_parser(name, help=help_text)
        p.add_argument("email")
    args = parser.parse_args(argv)

    from app.services.local_auth import email_problem, normalize_email

    email = normalize_email(args.email)
    if email_problem(email):
        print(f"error: invalid email address: {args.email}", file=sys.stderr)
        return 2
    if args.command == "reset-password":
        return _cmd_reset_password(email)
    return _cmd_set_password(email)


if __name__ == "__main__":
    sys.exit(main())
