# Copyright (c) 2026, Frappe Technologies and contributors
# License: MIT. See LICENSE

import frappe
from frappe.desk.dashboard_chart_source.todo_created_vs_completed.todo_created_vs_completed import get
from frappe.tests import IntegrationTestCase
from frappe.utils import getdate
from frappe.utils.dateutils import get_period

EXTRA_TEST_RECORD_DEPENDENCIES = ["User"]

CHART_NAME = "ToDo Created vs Completed"
CHART_CACHE_KEY = f"chart-data:{CHART_NAME}"

NOW = "2026-03-18 10:00:00"
DAILY_BUCKETS = 8
RANGE_FROM_DATE = "2026-03-16"
RANGE_TO_DATE = "2026-03-18"
RANGE_BUCKETS = 3
MONTHLY_BUCKET_ENDINGS = ("2025-12-31", "2026-01-31", "2026-02-28", "2026-03-31")


class TestToDoCreatedVsCompleted(IntegrationTestCase):
	"""Cover the ToDo Created vs Completed dashboard chart source."""

	def setUp(self):
		super().setUp()
		frappe.db.delete("ToDo")
		frappe.cache.delete_key(CHART_CACHE_KEY)

	def _make_todo(self, created_at, allocated_to="Administrator", description="_Test ToDo Analytics"):
		"""Insert one ToDo whose `creation` is `created_at` and return it."""
		with self.freeze_time(created_at):
			return frappe.get_doc(
				doctype="ToDo",
				description=description,
				allocated_to=allocated_to,
				assigned_by="Administrator",
			).insert()

	def _set_status(self, todo, status, at):
		"""Save `todo` with `status` so that its `modified` becomes `at`, and return it."""
		with self.freeze_time(at):
			todo.reload()
			todo.status = status
			todo.save()

		return todo

	def _get_chart(self, **kwargs):
		"""Return the chart payload of the saved chart, resolved against the frozen `NOW`."""
		with self.freeze_time(NOW):
			return get(chart_name=CHART_NAME, no_cache=1, **kwargs)

	def _series(self, result):
		"""Assert the dataset names and return the created and completed value lists."""
		self.assertEqual([dataset["name"] for dataset in result["datasets"]], ["Created", "Completed"])

		return result["datasets"][0]["values"], result["datasets"][1]["values"]

	def test_buckets_created_and_completed_daily(self):
		closed_early = self._make_todo("2026-03-12 09:00:00")
		closed_late = self._make_todo("2026-03-15 09:00:00")
		self._make_todo("2026-03-15 15:00:00")
		self._make_todo("2026-03-18 08:00:00")

		self._set_status(closed_early, "Closed", "2026-03-16 11:00:00")
		self._set_status(closed_late, "Closed", "2026-03-18 09:00:00")

		result = self._get_chart()
		created, completed = self._series(result)

		self.assertEqual(len(result["labels"]), DAILY_BUCKETS)
		self.assertEqual(created, [0, 1, 0, 0, 2, 0, 0, 1])
		self.assertEqual(completed, [0, 0, 0, 0, 0, 1, 0, 1])

	def test_zero_activity_days_are_zero_filled(self):
		self._make_todo("2026-03-17 12:00:00")

		result = self._get_chart()
		created, completed = self._series(result)

		self.assertEqual(len(result["labels"]), DAILY_BUCKETS)
		self.assertEqual(created, [0, 0, 0, 0, 0, 0, 1, 0])
		self.assertEqual(completed, [0] * DAILY_BUCKETS)

	def test_reopened_todo_not_counted_as_completed(self):
		todo = self._make_todo("2026-03-15 09:00:00")
		self._set_status(todo, "Closed", "2026-03-16 11:00:00")
		self._set_status(todo, "Open", "2026-03-17 11:00:00")

		created, completed = self._series(self._get_chart())

		self.assertEqual(created, [0, 0, 0, 0, 1, 0, 0, 0])
		self.assertEqual(completed, [0] * DAILY_BUCKETS)
		self.assertEqual(sum(completed), 0)

		self._set_status(todo, "Closed", "2026-03-18 09:00:00")

		created, completed = self._series(self._get_chart())

		self.assertEqual(created, [0, 0, 0, 0, 1, 0, 0, 0])
		self.assertEqual(completed, [0, 0, 0, 0, 0, 0, 0, 1])
		self.assertEqual(sum(completed), 1)

	def test_window_boundary_inclusive(self):
		self._make_todo("2026-03-11 00:00:00", description="_Test ToDo On Window Start")
		self._make_todo("2026-03-10 23:59:59", description="_Test ToDo Before Window Start")

		result = self._get_chart()
		created, completed = self._series(result)

		self.assertEqual(len(result["labels"]), DAILY_BUCKETS)
		self.assertEqual(created[0], 1)
		self.assertEqual(sum(created), 1)
		self.assertEqual(completed, [0] * DAILY_BUCKETS)

	def test_empty_state_returns_zero_filled_series(self):
		result = self._get_chart()

		self.assertIsNotNone(result)

		created, completed = self._series(result)

		self.assertEqual(len(result["labels"]), DAILY_BUCKETS)
		self.assertEqual(created, [0] * DAILY_BUCKETS)
		self.assertEqual(completed, [0] * DAILY_BUCKETS)

	def test_select_date_range_uses_from_to(self):
		self._make_todo("2026-03-17 12:00:00")

		result = self._get_chart(
			timespan="Select Date Range", from_date=RANGE_FROM_DATE, to_date=RANGE_TO_DATE
		)
		created, completed = self._series(result)

		self.assertEqual(len(result["labels"]), RANGE_BUCKETS)
		self.assertEqual(created, [0, 1, 0])
		self.assertEqual(completed, [0] * RANGE_BUCKETS)

	def test_counts_are_permission_scoped(self):
		self._make_todo("2026-03-17 09:00:00", allocated_to="test2@example.com")
		self._make_todo("2026-03-17 10:00:00", allocated_to="test1@example.com")

		with self.set_user("test2@example.com"):
			result = self._get_chart()

		created, completed = self._series(result)

		self.assertEqual(sum(created), 1)
		self.assertEqual(created, [0, 0, 0, 0, 0, 0, 1, 0])
		self.assertEqual(completed, [0] * DAILY_BUCKETS)

	def test_chart_payload_argument_supported(self):
		self._make_todo("2026-03-17 12:00:00")

		with self.freeze_time(NOW):
			saved_chart_result = get(chart_name=CHART_NAME, no_cache=1)
			payload_result = get(
				chart=frappe.as_json({"timespan": "Last Week", "time_interval": "Daily"}), no_cache=1
			)

		created, completed = self._series(payload_result)

		self.assertEqual(len(payload_result["labels"]), DAILY_BUCKETS)
		self.assertEqual(created, [0, 0, 0, 0, 0, 0, 1, 0])
		self.assertEqual(completed, [0] * DAILY_BUCKETS)
		self.assertEqual(payload_result, saved_chart_result)

	def test_monthly_interval_uses_period_labels(self):
		self._make_todo("2026-02-10 12:00:00")

		result = self._get_chart(timespan="Last Quarter", time_interval="Monthly")
		created, completed = self._series(result)

		self.assertEqual(
			result["labels"], [get_period(getdate(ending), "Monthly") for ending in MONTHLY_BUCKET_ENDINGS]
		)
		self.assertEqual(created, [0, 0, 1, 0])
		self.assertEqual(completed, [0] * len(MONTHLY_BUCKET_ENDINGS))

	def test_select_date_range_falls_back_to_chart_dates(self):
		self._make_todo("2026-03-17 12:00:00")

		result = get(
			chart=frappe.as_json(
				{
					"timespan": "Select Date Range",
					"time_interval": "Daily",
					"from_date": RANGE_FROM_DATE,
					"to_date": RANGE_TO_DATE,
				}
			),
			no_cache=1,
		)
		created, completed = self._series(result)

		self.assertEqual(len(result["labels"]), RANGE_BUCKETS)
		self.assertEqual(created, [0, 1, 0])
		self.assertEqual(completed, [0] * RANGE_BUCKETS)
