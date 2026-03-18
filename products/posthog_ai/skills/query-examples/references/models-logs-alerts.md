# Logs alerts

## LogsAlertConfiguration (`system.logs_alert_configurations`)

Configures threshold-based alerts on log streams. Each alert periodically counts log entries matching its filter criteria and fires when the count crosses a threshold.

### Columns

Column | Type | Nullable | Description
`id` | uuid | NOT NULL | Primary key
`team_id` | integer | NOT NULL | Project/team ID for isolation
`name` | varchar(255) | NOT NULL | Human-readable alert name
`enabled` | boolean | NOT NULL | Whether the alert is actively evaluated (default true)
`filters` | jsonb | NOT NULL | Filter criteria: `{severityLevels, serviceNames, filterGroup}`
`threshold_count` | integer | NOT NULL | Log count that constitutes a breach (>= 1)
`threshold_operator` | varchar(10) | NOT NULL | `above` or `below`
`window_minutes` | integer | NOT NULL | Time window for counting (1, 5, 10, 15, 30, or 60)
`check_interval_minutes` | integer | NOT NULL | Evaluation frequency in minutes
`state` | varchar(20) | NOT NULL | `not_firing`, `firing`, `pending_resolve`, `errored`, or `snoozed`
`evaluation_periods` | integer | NOT NULL | Total check periods in sliding window (M in N-of-M)
`datapoints_to_alarm` | integer | NOT NULL | Periods that must breach to trigger (N in N-of-M, <= evaluation_periods)
`cooldown_minutes` | integer | NOT NULL | Minutes between repeated notifications (0 = no cooldown)
`snooze_until` | timestamp with tz | NULL | Snoozed until this time
`next_check_at` | timestamp with tz | NULL | Next scheduled evaluation
`last_notified_at` | timestamp with tz | NULL | When the last notification was sent
`last_checked_at` | timestamp with tz | NULL | When the alert was last evaluated
`consecutive_failures` | integer | NOT NULL | Consecutive evaluation failures (resets on success)
`created_at` | timestamp with tz | NOT NULL | Creation timestamp
`updated_at` | timestamp with tz | NOT NULL | Last modification timestamp

### Important notes

- `state` values: `not_firing` (normal), `firing` (threshold breached), `pending_resolve` (was firing, checking if resolved), `errored` (evaluation failed), `snoozed` (temporarily muted).
- `filters` must contain at least one of: `severityLevels`, `serviceNames`, or `filterGroup`.
- Disabling an alert (`enabled = false`) resets `state` to `not_firing`.
- Maximum 20 alerts per team.

---

## Common query patterns

**List all enabled alerts with their current state:**

```sql
SELECT id, name, state, threshold_count, threshold_operator, window_minutes
FROM system.logs_alert_configurations
WHERE enabled
ORDER BY created_at DESC
```

**Find firing alerts:**

```sql
SELECT id, name, last_checked_at, consecutive_failures
FROM system.logs_alert_configurations
WHERE state = 'firing'
ORDER BY last_checked_at DESC
```

**Alerts filtering by severity levels in their filters:**

```sql
SELECT id, name, filters
FROM system.logs_alert_configurations
WHERE enabled
  AND JSONExtractString(filters, 'severityLevels') != '[]'
ORDER BY created_at DESC
```
