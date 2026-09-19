# Copyright (c) 2026, Frappe Technologies and contributors
# License: MIT. See LICENSE

from contextlib import contextmanager
from unittest.mock import patch

import frappe
from frappe.desk.dashboard_chart_source.todo_created_vs_completed.todo_created_vs_completed import (
	_cache_key,
	_resolve_chart,
	get,
)
from frappe.model.document import Document
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
SCOPED_USER = "test2@example.com"
AGGREGATE_QUERIES = 2
UNNAMED_CACHE_KEY = "chart-data::"


class TestToDoCreatedVsCompleted(IntegrationTestCase):
	"""Cover the ToDo Created vs Completed dashboard chart source."""

	def setUp(self):
		super().setUp()
		frappe.db.delete("ToDo")
		frappe.cache.delete_keys(CHART_CACHE_KEY)

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

	@contextmanager
	def _loaded_doctypes(self):
		"""Yield a list collecting the doctype of every document read from the database."""
		loaded = []
		load_from_db = Document.load_from_db

		def counted(doc, *args, **kwargs):
			loaded.append(doc.doctype)

			return load_from_db(doc, *args, **kwargs)

		with patch.object(Document, "load_from_db", counted):
			yield loaded

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

	def test_repeat_call_is_served_from_cache(self):
		"""A repeat widget call returns the cached payload without querying; refresh repopulates it."""
		self._make_todo("2026-03-17 12:00:00")

		with self.freeze_time(NOW):
			first = get(chart_name=CHART_NAME)

		self.assertTrue(frappe.cache.get_keys(CHART_CACHE_KEY))
		self.assertEqual(self._series(first)[0], [0, 0, 0, 0, 0, 0, 1, 0])

		self._make_todo("2026-03-18 08:00:00")

		with self.freeze_time(NOW):
			self.assertEqual(get(chart_name=CHART_NAME), first)

			with self.assertQueryCount(0):
				self.assertEqual(get(chart_name=CHART_NAME), first)

			refreshed = get(chart_name=CHART_NAME, refresh=1)

			self.assertEqual(self._series(refreshed)[0], [0, 0, 0, 0, 0, 0, 1, 1])
			self.assertEqual(get(chart_name=CHART_NAME, no_cache=1), refreshed)

			frappe.cache.delete_keys(CHART_CACHE_KEY)

			self.assertFalse(frappe.cache.get_keys(CHART_CACHE_KEY))
			self.assertEqual(get(chart_name=CHART_NAME), refreshed)

	def test_cached_payload_is_scoped_to_the_caller_and_the_window(self):
		"""Every caller and every requested window read their own entry under the chart prefix."""
		self._make_todo("2026-03-17 09:00:00", allocated_to=SCOPED_USER)
		self._make_todo("2026-03-17 10:00:00", allocated_to="test1@example.com")

		with self.freeze_time(NOW):
			default_key = _cache_key({"chart_name": CHART_NAME})
			range_key = _cache_key(
				{
					"chart_name": CHART_NAME,
					"timespan": "Select Date Range",
					"from_date": RANGE_FROM_DATE,
					"to_date": RANGE_TO_DATE,
				}
			)
			monthly_key = _cache_key(
				{"chart_name": CHART_NAME, "timespan": "Last Quarter", "time_interval": "Monthly"}
			)

			with self.set_user(SCOPED_USER):
				scoped_key = _cache_key({"chart_name": CHART_NAME})
				scoped = get(chart_name=CHART_NAME)

			everything = get(chart_name=CHART_NAME)
			ranged = get(
				chart_name=CHART_NAME,
				timespan="Select Date Range",
				from_date=RANGE_FROM_DATE,
				to_date=RANGE_TO_DATE,
			)

		self.assertEqual(len({default_key, range_key, monthly_key, scoped_key}), 4)
		for key in (default_key, range_key, monthly_key, scoped_key):
			self.assertTrue(key.startswith(f"{CHART_CACHE_KEY}:"))

		self.assertEqual(sum(self._series(everything)[0]), 2)
		self.assertEqual(sum(self._series(scoped)[0]), 1)
		self.assertEqual(len(ranged["labels"]), RANGE_BUCKETS)

	def test_chart_document_is_resolved_once_and_reused(self):
		"""The saved chart is read from the document cache, and an unsaved payload still resolves."""
		chart = _resolve_chart(CHART_NAME, None)

		self.assertEqual(chart.name, CHART_NAME)
		self.assertIs(_resolve_chart(CHART_NAME, None), chart)

		payload = _resolve_chart(None, frappe.as_json({"timespan": "Last Week", "time_interval": "Daily"}))

		self.assertIsNone(payload.name)
		self.assertEqual(payload.timespan, "Last Week")
		self.assertEqual(payload.time_interval, "Daily")

		with self.freeze_time(NOW):
			get(chart_name=CHART_NAME, no_cache=1)

			with self.assertQueryCount(AGGREGATE_QUERIES):
				get(chart_name=CHART_NAME, no_cache=1)

	def test_cold_miss_resolves_the_chart_once(self):
		"""A miss with the payload and document caches cleared reads the saved chart exactly once."""
		self._make_todo("2026-03-17 12:00:00")

		with self.freeze_time(NOW):
			get(chart_name=CHART_NAME, no_cache=1)

			for label, arguments in (("miss", {}), ("refresh", {"refresh": 1})):
				with self.subTest(call=label):
					frappe.cache.delete_keys(CHART_CACHE_KEY)
					frappe.clear_document_cache("Dashboard Chart", CHART_NAME)

					with self._loaded_doctypes() as loaded:
						result = get(chart_name=CHART_NAME, **arguments)

					self.assertEqual(loaded.count("Dashboard Chart"), 1)
					self.assertEqual(len(result["labels"]), DAILY_BUCKETS)
					self.assertEqual(self._series(result)[0], [0, 0, 0, 0, 0, 0, 1, 0])

	def test_unsaved_chart_payload_is_computed_on_every_path(self):
		"""An unsaved chart payload resolves its own window and is never cached under an empty name."""
		self._make_todo("2026-03-17 12:00:00")

		payload = frappe.as_json(
			{
				"timespan": "Select Date Range",
				"time_interval": "Daily",
				"from_date": RANGE_FROM_DATE,
				"to_date": RANGE_TO_DATE,
			}
		)

		with self.freeze_time(NOW):
			result = get(chart=payload)

			self.assertEqual(len(result["labels"]), RANGE_BUCKETS)
			self.assertEqual(self._series(result)[0], [0, 1, 0])
			self.assertEqual(get(chart=payload, no_cache=1), result)

		self.assertFalse(frappe.cache.get_keys(UNNAMED_CACHE_KEY))
