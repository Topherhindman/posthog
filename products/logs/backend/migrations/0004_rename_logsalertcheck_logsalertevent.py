import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    """Rename the Python class `LogsAlertCheck` to `LogsAlertEvent`.

    The physical table stays `logs_logsalertcheck` — renaming a live table is unsafe
    during rolling deploys (old pods would reference a table that no longer exists).
    `Meta.db_table` on the model is pinned to the original name, so these operations
    are state-only: they update Django's internal model state without touching the
    database. No ALTER TABLE, no lock.

    Also records the FK `related_name` change ("checks" → "events"); this is a
    Python-only ORM attribute that doesn't produce SQL either.
    """

    dependencies = [
        ("logs", "0003_alter_logsalertconfiguration_state"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RenameModel(
                    old_name="LogsAlertCheck",
                    new_name="LogsAlertEvent",
                ),
                migrations.AlterField(
                    model_name="logsalertevent",
                    name="alert",
                    field=models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="events",
                        to="logs.logsalertconfiguration",
                    ),
                ),
            ],
            database_operations=[],
        ),
    ]
