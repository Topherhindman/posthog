from django.contrib.postgres.operations import AddIndexConcurrently
from django.db import migrations, models


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ("posthog", "1100_add_subscription_summary_fields"),
    ]

    operations = [
        AddIndexConcurrently(
            model_name="sessionrecordingplaylistitem",
            index=models.Index(fields=["playlist"], name="srpi_playlist_idx"),
        ),
    ]
