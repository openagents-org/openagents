"""Per-workspace issue numbers (#1, #2, …) for short issue links.

Existing issues are numbered by creation order within their workspace.
"""
import sqlalchemy as sa
from alembic import op

# A nullable column; old application versions ignore it, and the issues they
# create during a rolling deploy simply keep NULL (still reachable by id).
deployment_backward_compatible = True
revision = "096"
down_revision = "095"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("issues", sa.Column("number", sa.Integer(), nullable=True))
    op.execute("""
        UPDATE issues SET number = numbered.n
        FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY created_at, id) AS n
            FROM issues
        ) AS numbered
        WHERE issues.id = numbered.id
    """)
    op.create_index("uq_issues_workspace_number", "issues", ["workspace_id", "number"], unique=True)


def downgrade():
    op.drop_index("uq_issues_workspace_number", table_name="issues")
    op.drop_column("issues", "number")
