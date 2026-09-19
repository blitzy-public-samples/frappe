# Copyright (c) 2026, Frappe Technologies and contributors
# License: MIT. See LICENSE

from unittest.mock import patch

import frappe
from frappe.desk.dashboard_chart_source.todo_created_vs_completed import (
	todo_created_vs_completed as trend_source,
)
from frappe.desk.dashboard_chart_source.todo_created_vs_completed.todo_created_vs_completed import (
	MAX_PERIODS,
	_resolve_window,
	get,
)
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, getdate
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
YEARLY_DAILY_BUCKETS = 366
ABUSIVE_FROM_DATE = "0002-01-01"
ABUSIVE_TO_DATE = "9999-12-31"


class TestToDoCreatedVsCompleted(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		frappe.db.delete("ToDo")
		frappe.cache.delete_keys(CHART_CACHE_KEY)

	def _make_todo(self, created_at, allocated_to="Administrator", description="_Test ToDo Analytics"):
		with self.freeze_time(created_at):
			return frappe.get_doc(
				doctype="ToDo",
				description=description,
				allocated_to=allocated_to,
				assigned_by="Administrator",
			).insert()

	def _set_status(self, todo, status, at):
		"""Set `todo.status`, save it at `at`, and return it. The save sets `modified` to `at`."""
		with self.freeze_time(at):
			todo.reload()
			todo.status = status
			todo.save()

		return todo

	def _get_chart(self, **kwargs):
		with self.freeze_time(NOW):
			return get(chart_name=CHART_NAME, no_cache=1, **kwargs)

	def _series(self, result):
		"""Assert the dataset names and return the created and completed value lists."""
		self.assertEqual([dataset["name"] for dataset in result["datasets"]], ["Created", "Completed"])

		return result["datasets"][0]["values"], result["datasets"][1]["values"]

	def test_buckets_created_and_completed_daily(self):
		closed_early = self._make_todo("2026-03-12 09:00:00")
		closed_late = self._make_todo("2026-03-15 09:00:00")
		cancelled = self._make_todo("2026-03-15 15:00:00")
		self._make_todo("2026-03-18 08:00:00")

		self._set_status(closed_early, "Closed", "2026-03-16 11:00:00")
		self._set_status(closed_late, "Closed", "2026-03-18 09:00:00")
		self._set_status(cancelled, "Cancelled", "2026-03-17 14:00:00")

		self.assertEqual(frappe.db.get_value("ToDo", cancelled.name, "status"), "Cancelled")

		result = self._get_chart()
		created, completed = self._series(result)

		self.assertEqual(len(result["labels"]), DAILY_BUCKETS)
		self.assertEqual(created, [0, 1, 0, 0, 2, 0, 0, 1])
		self.assertEqual(completed, [0, 0, 0, 0, 0, 1, 0, 1])
		self.assertEqual(created[4], 2)
		self.assertEqual(completed[6], 0)

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
		visible = self._make_todo("2026-03-17 09:00:00", allocated_to="test2@example.com")
		hidden = self._make_todo("2026-03-17 10:00:00", allocated_to="test1@example.com")

		self._set_status(visible, "Closed", "2026-03-18 09:00:00")
		self._set_status(hidden, "Closed", "2026-03-17 18:00:00")

		unscoped_created, unscoped_completed = self._series(self._get_chart())

		self.assertEqual(unscoped_created, [0, 0, 0, 0, 0, 0, 2, 0])
		self.assertEqual(unscoped_completed, [0, 0, 0, 0, 0, 0, 1, 1])

		with self.set_user("test2@example.com"):
			result = self._get_chart()

		created, completed = self._series(result)

		self.assertEqual(sum(created), 1)
		self.assertEqual(created, [0, 0, 0, 0, 0, 0, 1, 0])
		self.assertEqual(sum(completed), 1)
		self.assertEqual(completed, [0, 0, 0, 0, 0, 0, 0, 1])

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

	def test_window_rejects_unsupported_grains_spans_and_bounds(self):
		chart = frappe.get_doc("Dashboard Chart", CHART_NAME)
		rejected = (
			("abusive range", "Select Date Range", "Daily", ABUSIVE_FROM_DATE, ABUSIVE_TO_DATE),
			("reversed bounds", "Select Date Range", "Daily", RANGE_TO_DATE, RANGE_FROM_DATE),
			("unsupported time interval", "Last Week", "Hourly", None, None),
			("unsupported timespan", "All Time", "Daily", None, None),
		)

		for case, timespan, time_interval, from_date, to_date in rejected:
			with self.subTest(case=case):
				self.assertRaises(
					frappe.ValidationError,
					_resolve_window,
					chart,
					timespan,
					time_interval,
					from_date,
					to_date,
				)

		with patch.object(frappe, "get_list") as aggregated:
			self.assertRaises(
				frappe.ValidationError,
				get,
				chart_name=CHART_NAME,
				no_cache=1,
				timespan="Select Date Range",
				from_date=ABUSIVE_FROM_DATE,
				to_date=ABUSIVE_TO_DATE,
			)

		aggregated.assert_not_called()

	def test_window_rejects_more_readable_todos_than_the_aggregate_limit(self):
		for hour in range(3):
			self._make_todo(f"2026-03-17 0{hour}:00:00", description=f"_Test ToDo Analytics {hour}")

		with (
			patch.object(trend_source, "MAX_AGGREGATE_ROWS", 2),
			patch.object(trend_source, "get_result") as zero_filled,
		):
			self.assertRaises(frappe.ValidationError, self._get_chart)

		zero_filled.assert_not_called()

		created, completed = self._series(self._get_chart())

		self.assertEqual(sum(created), 3)
		self.assertEqual(completed, [0] * DAILY_BUCKETS)

	def test_window_accepts_windows_up_to_the_period_limit(self):
		self.assertEqual(len(self._get_chart(timespan="Last Year")["labels"]), YEARLY_DAILY_BUCKETS)

		limit_from_date = add_days(getdate(NOW), -(MAX_PERIODS - 1))
		result = self._get_chart(timespan="Select Date Range", from_date=str(limit_from_date), to_date=NOW)

		self.assertEqual(len(result["labels"]), MAX_PERIODS)
		self.assertEqual(sum(self._series(result)[0]), 0)

		self.assertRaises(
			frappe.ValidationError,
			get,
			chart_name=CHART_NAME,
			no_cache=1,
			timespan="Select Date Range",
			from_date=str(add_days(limit_from_date, -1)),
			to_date=NOW,
		)
