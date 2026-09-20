# Copyright (c) 2026, Frappe Technologies and contributors
# License: MIT. See LICENSE

import frappe
from frappe.desk.dashboard_chart_source.todo_top_owners.todo_top_owners import (
	TOP_N,
	_owner_label,
	_owner_labels,
	get,
	get_top_owners,
)
from frappe.tests import IntegrationTestCase
from frappe.utils import escape_html

EXTRA_TEST_RECORD_DEPENDENCIES = ["User"]

CHART_NAME = "ToDo Top Owners"
CHART_CACHE_KEY = f"chart-data:{CHART_NAME}"
UNNAMED_CHART_CACHE_KEY = "chart-data:None"

DATASET_NAME = "Open ToDos"
UNKNOWN_USER = "ghost@example.com"
MARKUP_USER = "<img src=x onerror=window.__xss2=1>@example.com"

MARKUP_FULL_NAMES = [
	"<img src=x onerror=window.__xss=1>",
	'"><svg onload=window.__xss3=1>',
	"<script>window.__xss4=1</script>",
]

FIVE_OWNERS = [
	"test1@example.com",
	"test2@example.com",
	"test3@example.com",
	"test4@example.com",
	"testperm@example.com",
]
OWNER_LOOKUP_WARM_QUERY_LIMIT = 2
CACHED_OWNER_LABEL_QUERY_LIMIT = 0
FOREIGN_CHARTS = ("ToDo Created vs Completed", "Login", "Email Activity")
UNKNOWN_CHART = "_Test No Such Dashboard Chart"
READ_HTTP_METHODS = ("GET", "POST", "QUERY")
POISONED_CHART_DATA = {
	"labels": ["_Test Poisoned Owner"],
	"datasets": [{"name": DATASET_NAME, "values": [4242]}],
}
SCOPED_USER = "test2@example.com"


class TestToDoTopOwners(IntegrationTestCase):
	def setUp(self):
		super().setUp()
		frappe.db.delete("ToDo")
		self._clear_chart_cache()
		self.addCleanup(self._clear_chart_cache)

	def _clear_chart_cache(self):
		frappe.cache.delete_keys(CHART_CACHE_KEY)
		frappe.cache.delete_keys(UNNAMED_CHART_CACHE_KEY)

	def _seed(self, owner, count=1, status="Open"):
		return [
			frappe.get_doc(
				doctype="ToDo",
				description=f"_Test ToDo Top Owners {owner} {status} {idx}",
				allocated_to=owner,
				assigned_by="Administrator",
				status=status,
			).insert()
			for idx in range(count)
		]

	def _chart(self):
		return get(chart_name=CHART_NAME, no_cache=1)

	def _full_name(self, user):
		return frappe.db.get_value("User", user, "full_name")

	def _label(self, user):
		return escape_html(self._full_name(user))

	def _set_full_name(self, user, full_name):
		frappe.db.set_value("User", user, "full_name", full_name)
		frappe.clear_document_cache("User", user)

	def _clear_user_document_cache(self):
		for owner in FIVE_OWNERS:
			frappe.clear_document_cache("User", owner)

	def test_ranked_top_five_with_counts(self):
		seeded = {
			"test1@example.com": 6,
			"test2@example.com": 5,
			"test3@example.com": 4,
			"test4@example.com": 3,
			"testperm@example.com": 2,
			"Administrator": 1,
		}
		for owner, count in seeded.items():
			self._seed(owner, count)

		ranked_owners = list(seeded)[:TOP_N]
		excluded_owner = list(seeded)[TOP_N]

		result = self._chart()

		self.assertEqual(len(result["labels"]), TOP_N)
		self.assertEqual(result["labels"], [self._label(owner) for owner in ranked_owners])
		self.assertEqual([dataset["name"] for dataset in result["datasets"]], [frappe._(DATASET_NAME)])
		self.assertEqual(result["datasets"][0]["values"], [6, 5, 4, 3, 2])
		self.assertNotIn(self._label(excluded_owner), result["labels"])
		self.assertNotIn(seeded[excluded_owner], result["datasets"][0]["values"])

		self.assertEqual([row.name for row in get_top_owners()], ranked_owners)
		self.assertEqual(len(get_top_owners(limit=2)), 2)

	def test_tie_break_by_user_id_ascending(self):
		owners = ["test3@example.com", "test1@example.com", "test2@example.com"]
		for owner in owners:
			self._seed(owner, 2)

		rows = get_top_owners()

		self.assertEqual([row.name for row in rows], sorted(owners))
		self.assertEqual([row["count"] for row in rows], [2, 2, 2])
		self.assertEqual(self._chart()["labels"], [self._label(owner) for owner in sorted(owners)])

	def test_fewer_than_five_owners(self):
		self._seed("test1@example.com", 3)
		self._seed("test2@example.com", 1)

		result = self._chart()

		self.assertEqual(
			result["labels"],
			[self._label("test1@example.com"), self._label("test2@example.com")],
		)
		self.assertEqual(result["datasets"][0]["values"], [3, 1])

	def test_excludes_closed_cancelled_and_unassigned(self):
		self._seed("test1@example.com", 2)
		self._seed("test1@example.com", 1, status="Closed")
		self._seed("test1@example.com", 1, status="Cancelled")
		self._seed("test2@example.com", 1)
		self._seed(None, 1)

		result = self._chart()

		self.assertEqual(
			result["labels"],
			[self._label("test1@example.com"), self._label("test2@example.com")],
		)
		self.assertEqual(result["datasets"][0]["values"], [2, 1])

	def test_empty_returns_none(self):
		self.assertEqual(get_top_owners(), [])
		self.assertIsNone(self._chart())

	def test_labels_use_full_name(self):
		owner = "test4@example.com"
		self._seed(owner)

		result = self._chart()

		self.assertEqual(result["labels"], [self._label(owner)])
		self.assertEqual(result["datasets"][0]["values"], [1])

	def test_label_falls_back_to_user_id(self):
		self.assertFalse(frappe.db.exists("User", UNKNOWN_USER))
		self.assertEqual(_owner_label(UNKNOWN_USER), UNKNOWN_USER)

	def test_labels_escape_markup_in_full_name(self):
		owner = "test4@example.com"
		self._seed(owner)
		self.addCleanup(self._set_full_name, owner, self._full_name(owner))

		for full_name in MARKUP_FULL_NAMES:
			with self.subTest(full_name=full_name):
				self._set_full_name(owner, full_name)

				escaped = escape_html(full_name)
				result = self._chart()

				self.assertNotEqual(escaped, full_name)
				self.assertNotIn("<", escaped)
				self.assertNotIn(">", escaped)
				self.assertEqual(result["labels"], [escaped])
				self.assertEqual(result["datasets"][0]["values"], [1])
				self.assertEqual([row.label for row in get_top_owners()], [escaped])
				self.assertEqual(_owner_label(owner), escaped)
				self.assertEqual(_owner_labels([owner]), {owner: escaped})

	def test_label_escapes_markup_in_user_id_fallback(self):
		self.assertFalse(frappe.db.exists("User", MARKUP_USER))

		label = _owner_label(MARKUP_USER)

		self.assertEqual(label, escape_html(MARKUP_USER))
		self.assertNotEqual(label, MARKUP_USER)
		self.assertNotIn("<", label)
		self.assertNotIn(">", label)

	def test_unidentifiable_chart_raises_client_error(self):
		self._seed("test1@example.com")

		for kwargs in (
			{},
			{"refresh": 1},
			{"chart_name": ""},
			{"chart": ""},
			{"chart_name": "", "chart": ""},
		):
			with self.subTest(kwargs=kwargs), self.assertRaises(frappe.exceptions.MandatoryError):
				get(**kwargs)

		for chart in ("{not json", "[1,2]", "5", "null", '"x"'):
			with self.subTest(chart=chart):
				with self.assertRaises(frappe.ValidationError) as raised:
					get(chart=chart, refresh=1)

				self.assertNotIsInstance(raised.exception, frappe.exceptions.MandatoryError)

		self.assertEqual(frappe.exceptions.MandatoryError.http_status_code, 417)
		self.assertEqual(frappe.ValidationError.http_status_code, 417)
		self.assertEqual(frappe.DoesNotExistError.http_status_code, 404)

		with self.assertRaises(frappe.DoesNotExistError):
			get(chart_name="Nope", refresh=1)

		expected = {
			"labels": [self._full_name("test1@example.com")],
			"datasets": [{"name": frappe._(DATASET_NAME), "values": [1]}],
		}

		self.assertEqual(get(chart=frappe.as_json({"name": CHART_NAME}), refresh=1), expected)
		self.assertEqual(get(chart={"timespan": "Last Week"}, refresh=1), expected)
		self.assertEqual(get(chart_name=CHART_NAME, refresh=1), expected)

	def test_owner_labels_load_one_user_document_per_distinct_owner(self):
		for owner in FIVE_OWNERS:
			self._seed(owner)

		self.assertEqual([row.name for row in get_top_owners()], FIVE_OWNERS)

		user_document_queries = 1 + len(frappe.get_meta("User").get_table_fields())
		owner_lookup_query_limit = 1 + TOP_N * user_document_queries

		self._clear_user_document_cache()

		with self.assertQueryCount(owner_lookup_query_limit):
			cold_rows = get_top_owners()

		with self.assertQueryCount(OWNER_LOOKUP_WARM_QUERY_LIMIT):
			warm_rows = get_top_owners()

		expected_labels = [self._label(owner) for owner in FIVE_OWNERS]

		for rows in (cold_rows, warm_rows):
			self.assertEqual([row.name for row in rows], FIVE_OWNERS)
			self.assertEqual([row.label for row in rows], expected_labels)

		with self.assertQueryCount(CACHED_OWNER_LABEL_QUERY_LIMIT):
			cached_labels = _owner_labels(FIVE_OWNERS)

		self.assertEqual([cached_labels[owner] for owner in FIVE_OWNERS], expected_labels)

		self._clear_user_document_cache()

		with self.assertQueryCount(TOP_N * user_document_queries):
			repeated_labels = _owner_labels([*FIVE_OWNERS, *FIVE_OWNERS])

		self.assertEqual([repeated_labels[owner] for owner in FIVE_OWNERS], expected_labels)

		labels = _owner_labels([*FIVE_OWNERS, UNKNOWN_USER])

		self.assertEqual(labels[UNKNOWN_USER], UNKNOWN_USER)
		self.assertEqual([labels[owner] for owner in FIVE_OWNERS], expected_labels)
		self.assertEqual(_owner_labels([]), {})

	def test_rejects_a_chart_that_is_not_bound_to_this_source(self):
		"""Only a chart whose `source` is this source is served, and no other chart is stamped."""
		self._seed("test1@example.com")

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

		self.assertEqual(self._chart()["datasets"][0]["values"], [1])

	def test_answers_only_read_http_methods(self):
		"""The method is whitelisted for GET and POST alone, so PUT and DELETE never reach it."""
		self.assertIn(get, frappe.whitelisted)
		self.assertEqual(frappe.allowed_http_methods_for_whitelisted_func[get], READ_HTTP_METHODS)

	def test_never_serves_the_stored_chart_data(self):
		"""Chart data left under the chart's cache key is served to no caller, whoever planted it."""
		self._seed("test1@example.com", 2)

		frappe.cache.set_value(CHART_CACHE_KEY, POISONED_CHART_DATA)
		frappe.db.set_value("Dashboard Chart", CHART_NAME, "last_synced_on", None, update_modified=False)

		plain_read = get(chart_name=CHART_NAME)

		self.assertIsNone(
			frappe.db.get_value("Dashboard Chart", CHART_NAME, "last_synced_on"),
			msg="a plain read recorded last_synced_on",
		)

		refreshed = get(chart_name=CHART_NAME, refresh=1)

		self.assertIsNotNone(frappe.db.get_value("Dashboard Chart", CHART_NAME, "last_synced_on"))

		for result in (plain_read, refreshed):
			self.assertNotEqual(result, POISONED_CHART_DATA)
			self.assertEqual(len(result["labels"]), 1)
			self.assertEqual(result["datasets"][0]["values"], [2])

		with self.set_user(SCOPED_USER):
			scoped_read = get(chart_name=CHART_NAME)

		self.assertIsNone(scoped_read, msg=f"{SCOPED_USER} received chart data of another user")
		self.assertEqual(frappe.cache.get_value(CHART_CACHE_KEY), POISONED_CHART_DATA)
