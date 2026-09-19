# Copyright (c) 2026, Frappe Technologies and contributors
# License: MIT. See LICENSE

import frappe
from frappe.desk.dashboard_chart_source.todo_top_owners.todo_top_owners import (
	TOP_N,
	_owner_label,
	get,
	get_top_owners,
)
from frappe.tests import IntegrationTestCase

EXTRA_TEST_RECORD_DEPENDENCIES = ["User"]

CHART_NAME = "ToDo Top Owners"
CHART_CACHE_KEY = f"chart-data:{CHART_NAME}"

DATASET_NAME = "Open ToDos"
UNKNOWN_USER = "ghost@example.com"


class TestToDoTopOwners(IntegrationTestCase):
	"""Cover the ToDo Top Owners dashboard chart source."""

	def setUp(self):
		super().setUp()
		frappe.db.delete("ToDo")
		frappe.cache.delete_key(CHART_CACHE_KEY)

	def _seed(self, owner, count=1, status="Open"):
		"""Insert `count` ToDos of `status` allocated to `owner` and return the inserted documents."""
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
		"""Return the payload the chart widget receives for the saved chart."""
		return get(chart_name=CHART_NAME, no_cache=1)

	def _full_name(self, user):
		"""Return the stored full name of `user`."""
		return frappe.db.get_value("User", user, "full_name")

	def test_ranked_top_five_with_counts(self):
		"""The payload holds the five highest open counts in descending order, excluding the sixth owner."""
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
		self.assertEqual(result["labels"], [self._full_name(owner) for owner in ranked_owners])
		self.assertEqual([dataset["name"] for dataset in result["datasets"]], [frappe._(DATASET_NAME)])
		self.assertEqual(result["datasets"][0]["values"], [6, 5, 4, 3, 2])
		self.assertNotIn(self._full_name(excluded_owner), result["labels"])
		self.assertNotIn(seeded[excluded_owner], result["datasets"][0]["values"])

		self.assertEqual([row.name for row in get_top_owners()], ranked_owners)
		self.assertEqual(len(get_top_owners(limit=2)), 2)

	def test_tie_break_by_user_id_ascending(self):
		"""Owners holding equal open counts are ordered by ascending user id."""
		owners = ["test3@example.com", "test1@example.com", "test2@example.com"]
		for owner in owners:
			self._seed(owner, 2)

		rows = get_top_owners()

		self.assertEqual([row.name for row in rows], sorted(owners))
		self.assertEqual([row["count"] for row in rows], [2, 2, 2])
		self.assertEqual(self._chart()["labels"], [self._full_name(owner) for owner in sorted(owners)])

	def test_fewer_than_five_owners(self):
		"""The payload holds one label and one value per owner when fewer than five owners exist."""
		self._seed("test1@example.com", 3)
		self._seed("test2@example.com", 1)

		result = self._chart()

		self.assertEqual(
			result["labels"],
			[self._full_name("test1@example.com"), self._full_name("test2@example.com")],
		)
		self.assertEqual(result["datasets"][0]["values"], [3, 1])

	def test_excludes_closed_cancelled_and_unassigned(self):
		"""Closed, Cancelled and unallocated ToDos are absent from the labels and from every count."""
		self._seed("test1@example.com", 2)
		self._seed("test1@example.com", 1, status="Closed")
		self._seed("test1@example.com", 1, status="Cancelled")
		self._seed("test2@example.com", 1)
		self._seed(None, 1)

		result = self._chart()

		self.assertEqual(
			result["labels"],
			[self._full_name("test1@example.com"), self._full_name("test2@example.com")],
		)
		self.assertEqual(result["datasets"][0]["values"], [2, 1])

	def test_empty_returns_none(self):
		"""The source returns None, not an empty payload, when no open allocated ToDo exists."""
		self.assertEqual(get_top_owners(), [])
		self.assertIsNone(self._chart())

	def test_labels_use_full_name(self):
		"""Each label is the full name of the owner it ranks."""
		owner = "test4@example.com"
		self._seed(owner)

		result = self._chart()

		self.assertEqual(result["labels"], [frappe.db.get_value("User", owner, "full_name")])
		self.assertEqual(result["datasets"][0]["values"], [1])

	def test_label_falls_back_to_user_id(self):
		"""A user id that resolves to no User record is used as its own label."""
		self.assertFalse(frappe.db.exists("User", UNKNOWN_USER))
		self.assertEqual(_owner_label(UNKNOWN_USER), UNKNOWN_USER)
