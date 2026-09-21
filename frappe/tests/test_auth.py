# Copyright (c) 2021, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE
import datetime
import time

import requests
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

import frappe
from frappe.auth import HTTPRequest, LoginAttemptTracker, get_hostname
from frappe.frappeclient import AuthError, FrappeClient
from frappe.sessions import Session, get_expired_sessions, get_expiry_in_seconds
from frappe.tests import IntegrationTestCase, UnitTestCase
from frappe.tests.test_api import FrappeAPITestCase
from frappe.utils import get_datetime, get_site_url, now, set_request
from frappe.utils.data import add_to_date
from frappe.www.login import _generate_temporary_login_link


def add_user(email, password, username=None, mobile_no=None):
	first_name = email.split("@", 1)[0]
	user = frappe.get_doc(
		doctype="User", email=email, first_name=first_name, username=username, mobile_no=mobile_no
	).insert()
	user.new_password = password
	user.simultaneous_sessions = 1
	user.add_roles("System Manager")
	frappe.db.commit()


class TestAuth(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		cls.HOST_NAME = frappe.get_site_config().host_name or get_site_url(frappe.local.site)
		cls.test_user_email = "test_auth@test.com"
		cls.test_user_name = "test_auth_user"
		cls.test_user_mobile = "+911234567890"
		cls.test_user_password = "pwd_012"

		cls.tearDownClass()
		add_user(
			email=cls.test_user_email,
			password=cls.test_user_password,
			username=cls.test_user_name,
			mobile_no=cls.test_user_mobile,
		)

	@classmethod
	def tearDownClass(cls):
		frappe.db.rollback()
		frappe.delete_doc("User", cls.test_user_email, force=True)
		frappe.local.request_ip = None
		frappe.form_dict.email = None
		frappe.local.response["http_status_code"] = None
		frappe.db.commit()

	def set_system_settings(self, k, v):
		frappe.db.set_single_value("System Settings", k, v)
		frappe.clear_cache()
		frappe.db.commit()

	def test_allow_login_using_mobile(self):
		self.set_system_settings("allow_login_using_mobile_number", 1)
		self.set_system_settings("allow_login_using_user_name", 0)

		# Login by both email and mobile should work
		FrappeClient(self.HOST_NAME, self.test_user_mobile, self.test_user_password)
		FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)

		# login by username should fail
		with self.assertRaises(AuthError):
			FrappeClient(self.HOST_NAME, self.test_user_name, self.test_user_password)

	def test_allow_login_using_only_email(self):
		self.set_system_settings("allow_login_using_mobile_number", 0)
		self.set_system_settings("allow_login_using_user_name", 0)

		# Login by mobile number should fail
		with self.assertRaises(AuthError):
			FrappeClient(self.HOST_NAME, self.test_user_mobile, self.test_user_password)

		# login by username should fail
		with self.assertRaises(AuthError):
			FrappeClient(self.HOST_NAME, self.test_user_name, self.test_user_password)

		# Login by email should work
		FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)

	def test_allow_login_using_username(self):
		self.set_system_settings("allow_login_using_mobile_number", 0)
		self.set_system_settings("allow_login_using_user_name", 1)

		# Mobile login should fail
		with self.assertRaises(AuthError):
			FrappeClient(self.HOST_NAME, self.test_user_mobile, self.test_user_password)

		# Both email and username logins should work
		FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)
		FrappeClient(self.HOST_NAME, self.test_user_name, self.test_user_password)

	def test_allow_login_using_username_and_mobile(self):
		self.set_system_settings("allow_login_using_mobile_number", 1)
		self.set_system_settings("allow_login_using_user_name", 1)

		# Both email and username and mobile logins should work
		FrappeClient(self.HOST_NAME, self.test_user_mobile, self.test_user_password)
		FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)
		FrappeClient(self.HOST_NAME, self.test_user_name, self.test_user_password)

	def test_deny_multiple_login(self):
		self.set_system_settings("deny_multiple_sessions", 1)
		self.addCleanup(self.set_system_settings, "deny_multiple_sessions", 0)

		first_login = FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)
		first_login.get_list("ToDo")

		second_login = FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)
		second_login.get_list("ToDo")
		with self.assertRaises(Exception):
			first_login.get_list("ToDo")

		third_login = FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)
		with self.assertRaises(Exception):
			first_login.get_list("ToDo")
		with self.assertRaises(Exception):
			second_login.get_list("ToDo")
		third_login.get_list("ToDo")

	def test_disable_user_pass_login(self):
		FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password).get_list("ToDo")
		self.set_system_settings("disable_user_pass_login", 1)
		self.addCleanup(self.set_system_settings, "disable_user_pass_login", 0)

		with self.assertRaises(Exception):
			FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password).get_list("ToDo")

	def test_login_with_email_link(self):
		user = self.test_user_email

		# Logs in
		res = requests.get(_generate_temporary_login_link(user, 10))
		self.assertEqual(res.status_code, 200)
		self.assertTrue(res.cookies.get("sid"))
		self.assertNotEqual(res.cookies.get("sid"), "Guest")

		# Random incorrect URL
		res = requests.get(_generate_temporary_login_link(user, 10) + "aa")
		self.assertEqual(res.cookies.get("sid"), "Guest")

		# POST doesn't work
		res = requests.post(_generate_temporary_login_link(user, 10))
		self.assertEqual(res.status_code, 403)

		# Rate limiting
		for _ in range(6):
			res = requests.get(_generate_temporary_login_link(user, 10))
			if res.status_code == 429:
				break
		else:
			self.fail("Rate limting not working")

	def test_correct_cookie_expiry_set(self):
		client = FrappeClient(self.HOST_NAME, self.test_user_email, self.test_user_password)

		expiry_time = next(x for x in client.session.cookies if x.name == "sid").expires
		current_time = datetime.datetime.now(tz=datetime.UTC).timestamp()
		self.assertAlmostEqual(get_expiry_in_seconds(), expiry_time - current_time, delta=60 * 60)


class TestAllowedReferrer(UnitTestCase):
	def test_is_allowed_referrer(self):
		def create_request(headers):
			builder = EnvironBuilder(headers=headers)
			env = builder.get_environ()
			return Request(env)

		# Set a single allowed referrer
		frappe.cache.set_value("allowed_referrers", ["https://example.com"])

		# Test with valid referrer
		frappe.local.request = create_request({"Referer": "https://example.com/some/path"})
		http_request = frappe.auth.HTTPRequest()
		self.assertTrue(http_request.is_allowed_referrer())

		# Test with invalid referrer
		frappe.local.request = create_request({"Referer": "https://malicious.com"})
		http_request = frappe.auth.HTTPRequest()
		self.assertFalse(http_request.is_allowed_referrer())

		# Test with valid origin
		frappe.local.request = create_request({"Origin": "https://example.com"})
		http_request = frappe.auth.HTTPRequest()
		self.assertTrue(http_request.is_allowed_referrer())

		# Test with invalid origin
		frappe.local.request = create_request({"Origin": "https://malicious.com"})
		http_request = frappe.auth.HTTPRequest()
		self.assertFalse(http_request.is_allowed_referrer())

		# Test subdomain bypass prevention
		frappe.local.request = create_request({"Referer": "https://example.com.evil.com"})
		http_request = frappe.auth.HTTPRequest()
		self.assertFalse(http_request.is_allowed_referrer())

		# Test exact domain match for referrer
		frappe.local.request = create_request({"Referer": "https://example.com"})
		http_request = frappe.auth.HTTPRequest()
		self.assertTrue(http_request.is_allowed_referrer())

		# Clean up
		frappe.cache.delete_value("allowed_referrers")
		frappe.local.request = None


class TestLoginAttemptTracker(IntegrationTestCase):
	def test_account_lock(self):
		"""Make sure that account locks after `n consecutive failures"""
		tracker = LoginAttemptTracker("tester", max_consecutive_login_attempts=3, lock_interval=60)
		# Clear the cache by setting attempt as success
		tracker.add_success_attempt()

		tracker.add_failure_attempt()
		self.assertTrue(tracker.is_user_allowed())

		tracker.add_failure_attempt()
		self.assertTrue(tracker.is_user_allowed())

		tracker.add_failure_attempt()
		self.assertTrue(tracker.is_user_allowed())

		tracker.add_failure_attempt()
		self.assertFalse(tracker.is_user_allowed())

	def test_account_unlock(self):
		"""Make sure that locked account gets unlocked after lock_interval of time."""
		lock_interval = 2  # In sec
		tracker = LoginAttemptTracker("tester", max_consecutive_login_attempts=1, lock_interval=lock_interval)
		# Clear the cache by setting attempt as success
		tracker.add_success_attempt()

		tracker.add_failure_attempt()
		self.assertTrue(tracker.is_user_allowed())

		tracker.add_failure_attempt()
		self.assertFalse(tracker.is_user_allowed())

		# Sleep for lock_interval of time, so that next request con unlock the user access.
		time.sleep(lock_interval)

		tracker.add_failure_attempt()
		self.assertTrue(tracker.is_user_allowed())


class TestSessionExpiry(FrappeAPITestCase):
	def test_session_expires(self):
		sid = self.sid  # triggers login for test case login
		s: Session = frappe.local.session_obj

		expiry_in = get_expiry_in_seconds()
		session_created = now()

		# Try with 1% increments of times, it should always work
		for step in range(0, 100, 1):
			seconds_elapsed = expiry_in * step / 100

			time_now = add_to_date(session_created, seconds=seconds_elapsed, as_string=True)
			with self.freeze_time(time_now):
				data = s.get_session_data_from_db()
				self.assertEqual(data.user, "Administrator")

		# 1% higher should immediately expire
		time_of_expiry = add_to_date(session_created, seconds=expiry_in * 1.01, as_string=True)
		with self.freeze_time(time_of_expiry):
			self.assertIn(sid, get_expired_sessions())
			self.assertFalse(s.get_session_data_from_db())

	def test_expired_session_answers_401_without_leaking_method(self):
		from frappe.auth import get_logged_user

		frappe.set_user("Guest")
		self.addCleanup(frappe.set_user, "Administrator")
		self.addCleanup(frappe.local.response.pop, "session_expired", None)
		self.addCleanup(frappe.clear_messages)

		frappe.local.response["session_expired"] = 1
		frappe.clear_messages()
		with self.assertRaises(frappe.SessionExpired):
			frappe.is_whitelisted(get_logged_user)
		self.assertEqual(
			frappe.get_message_log(), [], "an expired session must not send a message to the client"
		)

		frappe.local.response.pop("session_expired", None)
		with self.assertRaises(frappe.PermissionError):
			frappe.is_whitelisted(get_logged_user)

		def not_whitelisted():
			pass

		frappe.local.response["session_expired"] = 1
		with self.assertRaises(frappe.PermissionError):
			frappe.is_whitelisted(not_whitelisted)


class TestCSRFTokenValidation(IntegrationTestCase):
	"""Cover `HTTPRequest.validate_csrf_token` for sessions that hold a CSRF token and for sessions
	that do not, such as a cookie session created by `POST /api/method/login`."""

	SITE_HOST = "csrf-host.example"
	SITE_ORIGIN = f"http://{SITE_HOST}"
	FOREIGN_ORIGIN = "http://evil.example.com"
	SESSION_TOKEN = "a-stored-session-csrf-token"

	def setUp(self):
		self.addCleanup(
			self.restore_request_context,
			getattr(frappe.local, "request", None),
			getattr(frappe.local, "session", None),
			getattr(frappe.local, "form_dict", None),
			getattr(frappe.local, "session_obj", None),
		)
		for key in ("ignore_csrf", "allow_cors", "allowed_referrers"):
			self.addCleanup(self.restore_conf, key, frappe.conf.get(key))
		self.addCleanup(frappe.cache.delete_value, "allowed_referrers")
		self.addCleanup(frappe.clear_messages)
		self.addCleanup(frappe.flags.pop, "disable_traceback", None)

		frappe.conf.ignore_csrf = None
		frappe.conf.allow_cors = None
		frappe.conf.allowed_referrers = []
		frappe.cache.delete_value("allowed_referrers")

	@staticmethod
	def restore_request_context(request, session, form_dict, session_obj):
		frappe.local.request = request
		frappe.local.session = session
		frappe.local.form_dict = form_dict
		frappe.local.session_obj = session_obj

	@staticmethod
	def restore_conf(key, value):
		if value is None:
			frappe.conf.pop(key, None)
		else:
			frappe.conf[key] = value

	def validate(
		self,
		*,
		method: str = "POST",
		headers: dict | None = None,
		session_token: str | None = None,
		user: str = "Administrator",
		sid_cookie: bool = True,
		sid_in_request: bool = False,
		form_dict: dict | None = None,
	) -> None:
		"""Run `validate_csrf_token` against a synthesised request, session and form dict.

		`session_token` is the CSRF token the session holds, `None` synthesising a session created
		before tokens were minted at login. `sid_in_request` synthesises a session identified by an
		`sid` in the body or query string rather than by the cookie.
		"""
		request_headers = dict(headers or {})
		if sid_cookie:
			request_headers.setdefault("Cookie", "sid=a-session-id")

		set_request(
			path="/api/resource/ToDo",
			base_url=self.SITE_ORIGIN,
			method=method,
			headers=request_headers,
		)
		frappe.local.session = frappe._dict(user=user, data=frappe._dict(csrf_token=session_token))
		frappe.local.session_obj = frappe._dict(sid_from_request_parameter=sid_in_request)
		frappe.local.form_dict = frappe._dict(form_dict or {})

		HTTPRequest.validate_csrf_token(HTTPRequest.__new__(HTTPRequest))

	def assertRejected(self, **kwargs) -> None:
		with self.assertRaises(frappe.CSRFTokenError):
			self.validate(**kwargs)

	def test_cross_site_origin_rejected_when_session_has_no_token(self):
		self.assertRejected(headers={"Origin": self.FOREIGN_ORIGIN})

	def test_every_unsafe_method_rejected_cross_site_when_session_has_no_token(self):
		for method in ("POST", "PUT", "DELETE", "PATCH"):
			with self.subTest(method=method):
				self.assertRejected(method=method, headers={"Origin": self.FOREIGN_ORIGIN})

	def test_cross_site_fetch_metadata_rejected_when_session_has_no_token(self):
		for fetch_site in ("cross-site", "same-site"):
			with self.subTest(fetch_site=fetch_site):
				self.assertRejected(headers={"Sec-Fetch-Site": fetch_site})

	def test_foreign_referrer_rejected_when_session_has_no_token(self):
		self.assertRejected(headers={"Referer": f"{self.FOREIGN_ORIGIN}/attack.html"})

	def test_opaque_origin_rejected_when_session_has_no_token(self):
		self.assertRejected(headers={"Origin": "null"})

	def test_same_origin_request_allowed_when_session_has_no_token(self):
		self.validate(headers={"Origin": self.SITE_ORIGIN})
		self.validate(headers={"Origin": self.SITE_ORIGIN, "Sec-Fetch-Site": "same-origin"})
		self.validate(headers={"Referer": f"{self.SITE_ORIGIN}/desk/todo"})
		self.validate(headers={"Sec-Fetch-Site": "none"})

	def test_configured_host_name_counts_as_same_origin(self):
		self.addCleanup(self.restore_conf, "host_name", frappe.conf.get("host_name"))
		frappe.conf.host_name = "https://portal.example.com"

		self.validate(headers={"Origin": "https://portal.example.com"})
		self.assertRejected(headers={"Origin": "https://portal.example.net"})

	def test_request_without_browser_origin_rejected_when_session_has_no_token(self):
		"""A non-browser client on a token-less cookie session carries no same-site evidence."""
		self.assertRejected()

	def test_token_less_session_requires_positive_same_site_evidence(self):
		self.validate(headers={"Sec-Fetch-Site": "same-origin"})
		self.validate(headers={"Origin": self.SITE_ORIGIN})
		self.validate(headers={"Referer": f"{self.SITE_ORIGIN}/desk/todo"})

		self.assertRejected(headers={})
		self.assertRejected(headers={"Sec-Fetch-Site": "cross-site", "Origin": self.SITE_ORIGIN})

	def test_sid_in_form_dict_without_cookie_is_not_subject_to_csrf(self):
		"""An `sid` supplied in the body or query string is not an ambient cookie credential."""
		self.validate(
			sid_cookie=False,
			sid_in_request=True,
			form_dict={"sid": "a-session-id"},
			headers={"Origin": self.FOREIGN_ORIGIN},
		)

		# the cookie a previous response left behind does not make such a request ambient
		self.validate(
			sid_in_request=True,
			form_dict={"sid": "a-session-id"},
			headers={"Origin": self.FOREIGN_ORIGIN},
		)
		self.validate(
			sid_in_request=True,
			session_token=self.SESSION_TOKEN,
			form_dict={"sid": "a-session-id"},
			headers={"Origin": self.FOREIGN_ORIGIN},
		)

	def test_guest_session_allowed_when_session_has_no_token(self):
		self.validate(user="Guest", headers={"Origin": self.FOREIGN_ORIGIN})

	def test_request_without_session_cookie_allowed_when_session_has_no_token(self):
		self.validate(sid_cookie=False, headers={"Origin": self.FOREIGN_ORIGIN})

	def test_allowed_referrers_conf_allows_cross_site_request_without_token(self):
		frappe.conf.allowed_referrers = [self.FOREIGN_ORIGIN]
		frappe.cache.delete_value("allowed_referrers")

		self.validate(headers={"Origin": self.FOREIGN_ORIGIN})
		self.validate(headers={"Referer": f"{self.FOREIGN_ORIGIN}/embedded.html"})

	def test_allow_cors_conf_allows_cross_site_request_without_token(self):
		"""An explicitly configured origin is an allow-list; the wildcard `"*"` is not."""
		for allow_cors in (self.FOREIGN_ORIGIN, [self.FOREIGN_ORIGIN, "http://other.example"]):
			with self.subTest(allow_cors=allow_cors):
				frappe.conf.allow_cors = allow_cors
				self.validate(headers={"Origin": self.FOREIGN_ORIGIN})

		frappe.conf.allow_cors = ["http://other.example"]
		self.assertRejected(headers={"Origin": self.FOREIGN_ORIGIN})

		frappe.conf.allow_cors = "*"
		self.assertRejected(headers={"Origin": self.FOREIGN_ORIGIN})
		self.assertRejected()

	def test_safe_methods_are_never_validated(self):
		for method in ("GET", "HEAD", "OPTIONS", "QUERY"):
			with self.subTest(method=method):
				self.validate(method=method, headers={"Origin": self.FOREIGN_ORIGIN})
				self.validate(
					method=method,
					headers={"Origin": self.FOREIGN_ORIGIN},
					session_token=self.SESSION_TOKEN,
				)

	def test_ignore_csrf_conf_skips_validation(self):
		frappe.conf.ignore_csrf = 1

		self.validate(headers={"Origin": self.FOREIGN_ORIGIN})
		self.validate(headers={"Origin": self.FOREIGN_ORIGIN}, session_token=self.SESSION_TOKEN)

	def test_session_with_token_requires_a_matching_token(self):
		self.assertRejected(session_token=self.SESSION_TOKEN)
		self.assertRejected(session_token=self.SESSION_TOKEN, headers={"Origin": self.SITE_ORIGIN})
		self.assertRejected(
			session_token=self.SESSION_TOKEN, headers={"X-Frappe-CSRF-Token": "a-wrong-token"}
		)

	def test_session_with_token_accepts_a_matching_token(self):
		self.validate(
			session_token=self.SESSION_TOKEN,
			headers={"X-Frappe-CSRF-Token": self.SESSION_TOKEN, "Origin": self.FOREIGN_ORIGIN},
		)

		self.validate(session_token=self.SESSION_TOKEN, form_dict={"csrf_token": self.SESSION_TOKEN})
		self.assertNotIn("csrf_token", frappe.local.form_dict)

	def test_supplied_token_is_removed_from_the_form_dict(self):
		self.assertRejected(form_dict={"csrf_token": "a-token-for-a-token-less-session"})
		self.assertNotIn("csrf_token", frappe.local.form_dict)

		self.validate(
			headers={"Sec-Fetch-Site": "same-origin"},
			form_dict={"csrf_token": "a-token-for-a-token-less-session"},
		)
		self.assertNotIn("csrf_token", frappe.local.form_dict)


class TestLoginMintsCSRFToken(IntegrationTestCase):
	"""Cover the CSRF token that `POST /api/method/login` mints, stores and returns."""

	def test_api_login_mints_stores_and_returns_a_csrf_token(self):
		self.addCleanup(
			self.restore_login_context,
			getattr(frappe.local, "request", None),
			getattr(frappe.local, "session", None),
			getattr(frappe.local, "session_obj", None),
			getattr(frappe.local, "login_manager", None),
			getattr(frappe.local, "cookie_manager", None),
			getattr(frappe.local, "request_ip", None),
			frappe.local.response,
			dict(frappe.local.form_dict),
		)

		set_request(path="/api/method/login", method="POST", base_url=get_site_url(frappe.local.site))
		frappe.local.response = frappe._dict()
		frappe.local.form_dict = frappe._dict(usr="Administrator", pwd=frappe.conf.admin_password or "admin")

		# the whole request path: the login creates the session, then CSRF validation runs on it
		HTTPRequest()
		sid = frappe.session.sid
		self.addCleanup(self.delete_session_record, sid)

		token = frappe.session.data.csrf_token
		self.assertIsInstance(token, str)
		self.assertTrue(token)
		self.assertEqual(frappe.local.response["csrf_token"], token)

		Sessions = frappe.qb.DocType("Sessions")
		stored = (frappe.qb.from_(Sessions).select(Sessions.sessiondata).where(Sessions.sid == sid)).run()[0][
			0
		]
		self.assertEqual(frappe.parse_json(stored).csrf_token, token)
		self.assertEqual(frappe.sessions.get_csrf_token(), token)

	@staticmethod
	def restore_login_context(
		request, session, session_obj, login_manager, cookie_manager, request_ip, response, form_dict
	):
		frappe.local.request = request
		frappe.local.session = session
		frappe.local.session_obj = session_obj
		frappe.local.login_manager = login_manager
		frappe.local.cookie_manager = cookie_manager
		frappe.local.request_ip = request_ip
		frappe.local.response = response
		frappe.local.form_dict = frappe._dict(form_dict)

	@staticmethod
	def delete_session_record(sid: str) -> None:
		frappe.db.delete("Sessions", {"sid": sid})
		frappe.db.commit()
		frappe.cache.hdel("session", sid)


class TestHostname(UnitTestCase):
	def test_get_hostname_normalizes_urls_origins_and_hosts(self):
		self.assertEqual(get_hostname("http://example.com/desk/todo"), "example.com")
		self.assertEqual(get_hostname("https://Example.COM"), "example.com")
		self.assertEqual(get_hostname("https://www.example.com:8000"), "example.com")
		self.assertEqual(get_hostname("example.com:8000"), "example.com")
		self.assertEqual(get_hostname("null"), "null")

	def test_get_hostname_returns_empty_string_for_unusable_input(self):
		self.assertEqual(get_hostname(""), "")
		self.assertEqual(get_hostname(None), "")
		self.assertEqual(get_hostname("http://["), "")
