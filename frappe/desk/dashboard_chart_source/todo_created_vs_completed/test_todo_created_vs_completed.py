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
WIDE_FROM_DATE = "2020-01-01"
MALFORMED_DATES = ("not-a-date", "Invalid date", "13-45-2026")
MALFORMED_PAYLOADS = ("{not json", "[1,2,3]", '"just a string"')
FOREIGN_CHARTS = ("ToDo Top Owners", "Login", "Email Activity")
UNKNOWN_CHART = "_Test No Such Dashboard Chart"
READ_HTTP_METHODS = ("GET", "POST", "QUERY")
POISONED_CHART_DATA = {
	"labels": ["_Test Poisoned Label"],
	"datasets": [
		{"name": "Created", "values": [4242]},
		{"name": "Completed", "values": [4242]},
	],
}


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
		on_last_day = self._make_todo("2026-03-18 09:00:00")
		self._set_status(on_last_day, "Closed", "2026-03-18 09:30:00")

		result = self._get_chart(
			timespan="Select Date Range", from_date=RANGE_FROM_DATE, to_date=RANGE_TO_DATE
		)
		created, completed = self._series(result)

		self.assertEqual(len(result["labels"]), RANGE_BUCKETS)
		self.assertEqual(created, [0, 1, 1])
		self.assertEqual(completed, [0, 0, 1])

		explicit_bounds = self._get_chart(
			timespan="Select Date Range",
			from_date=RANGE_FROM_DATE,
			to_date=f"{RANGE_TO_DATE} 23:59:59",
		)

		self.assertEqual(result, explicit_bounds)

		single_day = self._get_chart(
			timespan="Select Date Range", from_date=RANGE_TO_DATE, to_date=RANGE_TO_DATE
		)

		self.assertEqual(len(single_day["labels"]), 1)
		self.assertEqual(self._series(single_day), ([1], [1]))

		morning_only = self._get_chart(
			timespan="Select Date Range",
			from_date=RANGE_TO_DATE,
			to_date=f"{RANGE_TO_DATE} 08:00:00",
		)

		self.assertEqual(self._series(morning_only), ([0], [0]))

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
			*(
				(f"malformed from date {value}", "Select Date Range", "Daily", value, RANGE_TO_DATE)
				for value in MALFORMED_DATES
			),
			*(
				(f"malformed to date {value}", "Select Date Range", "Daily", RANGE_FROM_DATE, value)
				for value in MALFORMED_DATES
			),
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

	def test_rejects_a_malformed_or_missing_chart_argument(self):
		with self.freeze_time(NOW):
			for payload in MALFORMED_PAYLOADS:
				with self.subTest(payload=payload):
					self.assertRaises(frappe.ValidationError, get, chart=payload, no_cache=1)
					self.assertRaises(frappe.ValidationError, get, chart=payload, refresh=1)

			for case, kwargs in (
				("no chart at all", {}),
				("cached without a chart", {"refresh": 1}),
				("empty chart name", {"chart_name": "", "refresh": 1}),
			):
				with self.subTest(case=case):
					self.assertRaises(frappe.ValidationError, get, **kwargs)

			self.assertEqual(len(get(no_cache=1)["labels"]), DAILY_BUCKETS)
			self.assertEqual(len(get(chart="{}", no_cache=1)["labels"]), DAILY_BUCKETS)

	def test_each_series_runs_one_permission_scoped_aggregation(self):
		self._make_todo("2026-03-17 12:00:00")

		aggregations = []
		unpatched_get_list = frappe.get_list

		def counting_get_list(doctype, *args, **kwargs):
			aggregations.append(doctype)
			return unpatched_get_list(doctype, *args, **kwargs)

		with patch.object(frappe, "get_list", counting_get_list):
			created, completed = self._series(self._get_chart())

		self.assertEqual(aggregations, ["ToDo", "ToDo"])
		self.assertEqual(sum(created), 1)
		self.assertEqual(sum(completed), 0)

	def test_window_accepts_windows_up_to_the_period_limit(self):
		self.assertEqual(len(self._get_chart(timespan="Last Year")["labels"]), YEARLY_DAILY_BUCKETS)

		wide_window = self._get_chart(timespan="Select Date Range", from_date=WIDE_FROM_DATE, to_date=NOW)

		self.assertEqual(len(wide_window["labels"]), (getdate(NOW) - getdate(WIDE_FROM_DATE)).days + 1)
		self.assertEqual(sum(self._series(wide_window)[0]), 0)

		with patch.object(trend_source, "MAX_PERIODS", RANGE_BUCKETS):
			at_limit = self._get_chart(
				timespan="Select Date Range", from_date=RANGE_FROM_DATE, to_date=RANGE_TO_DATE
			)

			self.assertEqual(len(at_limit["labels"]), RANGE_BUCKETS)
			self.assertRaises(
				frappe.ValidationError,
				get,
				chart_name=CHART_NAME,
				no_cache=1,
				timespan="Select Date Range",
				from_date=str(add_days(getdate(RANGE_FROM_DATE), -1)),
				to_date=RANGE_TO_DATE,
			)

		self.assertGreater(MAX_PERIODS, (getdate(NOW) - getdate(WIDE_FROM_DATE)).days + 1)

	def test_rejects_a_chart_that_is_not_bound_to_this_source(self):
		"""Only a chart whose `source` is this source is served, and no other chart is stamped."""
		self._make_todo("2026-03-17 12:00:00")

		self.assertEqual(frappe.db.get_value("Dashboard Chart", CHART_NAME, "source"), CHART_NAME)

		foreign_charts = [name for name in FOREIGN_CHARTS if frappe.db.exists("Dashboard Chart", name)]

		self.assertIn(FOREIGN_CHARTS[0], foreign_charts)

		for chart_name in [*foreign_charts, UNKNOWN_CHART]:
			with self.subTest(chart=chart_name):
				stamp = frappe.db.get_value("Dashboard Chart", chart_name, "last_synced_on")

				for kwargs in ({}, {"refresh": 1}, {"no_cache": 1}):
					with self.subTest(arguments=kwargs), self.assertRaises(frappe.DoesNotExistError):
						get(chart_name=chart_name, **kwargs)

				self.assertEqual(
					frappe.db.get_value("Dashboard Chart", chart_name, "last_synced_on"),
					stamp,
					msg=f"Dashboard Chart {chart_name} was stamped by a request this source refused",
				)

		self.assertEqual(sum(self._series(self._get_chart())[0]), 1)

	def test_answers_only_read_http_methods(self):
		"""The method is whitelisted for GET and POST alone, so PUT and DELETE never reach it."""
		self.assertIn(get, frappe.whitelisted)
		self.assertEqual(frappe.allowed_http_methods_for_whitelisted_func[get], READ_HTTP_METHODS)

	def test_never_serves_the_stored_chart_data(self):
		"""Chart data left under the chart's cache key is ignored, and a plain read stamps nothing."""
		self._make_todo("2026-03-17 12:00:00")

		frappe.cache.set_value(CHART_CACHE_KEY, POISONED_CHART_DATA)
		self.addCleanup(frappe.cache.delete_keys, CHART_CACHE_KEY)
		frappe.db.set_value("Dashboard Chart", CHART_NAME, "last_synced_on", None, update_modified=False)

		with self.freeze_time(NOW):
			plain_read = get(chart_name=CHART_NAME)

		self.assertIsNone(
			frappe.db.get_value("Dashboard Chart", CHART_NAME, "last_synced_on"),
			msg="a plain read recorded last_synced_on",
		)

		with self.freeze_time(NOW):
			refreshed = get(chart_name=CHART_NAME, refresh=1)

		self.assertIsNotNone(frappe.db.get_value("Dashboard Chart", CHART_NAME, "last_synced_on"))

		for result in (plain_read, refreshed):
			created, completed = self._series(result)

			self.assertNotEqual(result, POISONED_CHART_DATA)
			self.assertEqual(len(result["labels"]), DAILY_BUCKETS)
			self.assertEqual(created, [0, 0, 0, 0, 0, 0, 1, 0])
			self.assertEqual(completed, [0] * DAILY_BUCKETS)

		self.assertEqual(frappe.cache.get_value(CHART_CACHE_KEY), POISONED_CHART_DATA)
