describe("ToDo Analytics Dashboard", { scrollBehavior: false }, () => {
	const dashboard_user = "Administrator";
	const trend_chart = "ToDo Created vs Completed";
	const top_owners_chart = "ToDo Top Owners";
	const driven_charts = [trend_chart, top_owners_chart];
	const create_dashboard_settings =
		"frappe.desk.doctype.dashboard_settings.dashboard_settings.create_dashboard_settings";
	const save_chart_config =
		"frappe.desk.doctype.dashboard_settings.dashboard_settings.save_chart_config";

	// The chart widget whose title is `title`.
	const chart_widget = (title) => cy.contains(".dashboard-widget-box", title);

	// Documents inserted by the running case, in insertion order, and the result of deleting each.
	let seeded_docs = [];
	let deletions = [];

	// Inserts a document and registers it for the afterEach cleanup.
	const seed_doc = (doctype, args) =>
		cy.insert_doc(doctype, args, true).then((doc) => {
			if (doc && doc.name) {
				seeded_docs.push({ doctype: doctype, name: doc.name });
			}

			return doc;
		});

	// Deletes every registered document, newest first, and keeps each response for the assertions
	// that run after the whole cleanup.
	const remove_seeded_docs = () =>
		cy.then(() => {
			seeded_docs
				.slice()
				.reverse()
				.forEach((doc) =>
					cy.remove_doc(doc.doctype, doc.name, true).then((response) => {
						deletions.push({
							doctype: doc.doctype,
							name: doc.name,
							result: response && response.data,
						});
					})
				);
		});

	// Leaves a Desk window loaded, holding the CSRF token the cy.request commands read.
	const desk_window = () =>
		cy.window({ log: false }).then((win) => {
			if (!win.frappe || !win.frappe.csrf_token) {
				cy.visit("/desk");
			}
		});

	// This user's Dashboard Settings as the spec found it: whether the row was there at all, and
	// the raw chart_config value it held.
	let settings_snapshot = { exists: false, chart_config: null };

	const read_dashboard_settings = () =>
		cy
			.get_list(
				"Dashboard Settings",
				["name", "chart_config"],
				[["name", "=", dashboard_user]]
			)
			.then((response) => (response.data.length ? response.data[0] : null));

	// Drops this user's persisted window for every chart this spec drives, leaving the window of
	// the chart record itself in effect (RB-7).
	const reset_chart_config = () => {
		cy.call(create_dashboard_settings, { user: dashboard_user });
		driven_charts.forEach((chart_name) =>
			cy.call(save_chart_config, { reset: 1, config: {}, chart_name: chart_name })
		);
	};

	// Puts Dashboard Settings back as the spec found it: the raw chart_config of the row it read,
	// or no row at all.
	const restore_dashboard_settings = () => {
		if (settings_snapshot.exists) {
			cy.update_doc("Dashboard Settings", dashboard_user, {
				chart_config: settings_snapshot.chart_config,
			});
		} else {
			cy.remove_doc("Dashboard Settings", dashboard_user, true);
		}
	};

	before(() => {
		cy.login("Administrator");
		cy.visit("/desk");

		read_dashboard_settings().then((settings) => {
			settings_snapshot = {
				exists: Boolean(settings),
				chart_config: settings ? settings.chart_config : null,
			};
		});
	});

	beforeEach(() => {
		seeded_docs = [];
		deletions = [];
		desk_window();
		reset_chart_config();

		// Fixture of the case: one open ToDo allocated to each of two owners.
		seed_doc("ToDo", {
			description: "Cypress ToDo Analytics fixture for Administrator",
			allocated_to: dashboard_user,
			assigned_by: dashboard_user,
		});
		seed_doc("ToDo", {
			description: "Cypress ToDo Analytics fixture for the test user",
			allocated_to: Cypress.config("testUser"),
			assigned_by: dashboard_user,
		});
	});

	afterEach(() => {
		desk_window();
		remove_seeded_docs();
		restore_dashboard_settings();

		// Asserted only once every cleanup command above has run.
		cy.then(() => {
			deletions.forEach((deletion) =>
				expect(deletion.result, `deleted ${deletion.doctype} ${deletion.name}`).to.equal(
					"ok"
				)
			);
		});
		read_dashboard_settings().then((settings) => {
			expect(Boolean(settings), "Dashboard Settings row as found").to.equal(
				settings_snapshot.exists
			);
			expect(
				settings ? settings.chart_config : null,
				"Dashboard Settings chart_config as found"
			).to.equal(settings_snapshot.chart_config);
		});
	});

	it("renders two cards and two charts", () => {
		seed_doc("ToDo", {
			description: "Cypress ToDo Analytics seed one",
			allocated_to: "Administrator",
			assigned_by: "Administrator",
		});

		seed_doc("ToDo", {
			description: "Cypress ToDo Analytics seed two",
			allocated_to: "Administrator",
			assigned_by: "Administrator",
		});

		cy.visit("/desk/dashboard-view/ToDo Analytics");

		cy.title().should("eq", "ToDo Analytics Dashboard");
		cy.get(".navbar-breadcrumbs").should("contain.text", "ToDo Analytics");

		cy.get(".number-widget-box").should("have.length", 2);
		cy.get(".number-widget-box .widget-title").should("contain.text", "ToDo Total Open");
		cy.get(".number-widget-box .widget-title").should("contain.text", "ToDo Total Closed");

		cy.get(".dashboard-widget-box").should("have.length", 2);
		cy.findByText("ToDo Created vs Completed").should("be.visible");
		cy.findByText("ToDo Top Owners").should("be.visible");

		cy.get(".dashboard-widget-box .chart-loading-state.text-extra-muted").should(
			"not.be.visible"
		);
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);
		cy.get(".dashboard-widget-box .chart-loading-state.text-danger").should("not.be.visible");

		// baseline y-axis tick of both charts is labelled
		cy.get(".dashboard-widget-box").each(($widget) => {
			cy.wrap($widget).find(".y.axis text").first().should("have.text", "0");
		});

		// hovering the body of a Top Owners bar reveals its tooltip
		chart_widget(top_owners_chart).should(($widget) => {
			const bar = $widget.find("rect.bar")[0];
			const tip = $widget.find(".graph-svg-tip")[0];
			const box = bar.getBoundingClientRect();
			const win = bar.ownerDocument.defaultView;

			bar.dispatchEvent(
				new win.MouseEvent("mousemove", {
					bubbles: true,
					clientX: box.left + box.width / 2,
					clientY: box.top + box.height / 2,
				})
			);

			expect(tip.style.opacity).to.equal("1");
			expect(tip.innerText).to.contain("Open ToDos");
		});

		// chart and card controls carry an accessible name and menu semantics
		cy.get(".dashboard-widget-box .filter-chart")
			.should("have.length", 2)
			.each(($button) => {
				cy.wrap($button)
					.should("have.prop", "tagName", "BUTTON")
					.and("have.attr", "aria-label", "Set Filters");
			});
		cy.get(".dashboard-widget-box .chart-menu")
			.should("have.length", 2)
			.each(($button) => {
				cy.wrap($button).should("have.attr", "aria-label", "Chart Actions");
			});
		cy.get('.number-widget-box .card-actions [data-toggle="dropdown"]')
			.should("have.length", 2)
			.each(($toggle) => {
				cy.wrap($toggle)
					.should("have.attr", "aria-label", "Card Actions")
					.and("have.attr", "tabindex", "0");
			});
		cy.get(".dashboard-widget-box .timespan-filter .dropdown-item")
			.first()
			.should("have.attr", "role", "menuitemradio")
			.and("have.attr", "tabindex", "-1");

		// the chart menu is operable from the keyboard alone
		chart_widget(trend_chart)
			.find(".chart-menu")
			.focus()
			.trigger("keydown", { key: "ArrowDown", keyCode: 40, which: 40 })
			.parent()
			.should("have.class", "show");
		chart_widget(trend_chart)
			.find(".chart-menu")
			.trigger("keydown", { key: "ArrowDown", keyCode: 40, which: 40 });
		cy.focused().should("have.class", "dropdown-item").and("have.attr", "role", "menuitem");
		cy.focused().trigger("keydown", { key: "Enter", keyCode: 13, which: 13 });
		chart_widget(trend_chart).find(".chart-menu").parent().should("not.have.class", "show");
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);
	});

	it("formats axis ticks consistently and keeps axis labels legible", () => {
		// 0, thousands-separated integers, up to two decimals, or one number system symbol
		const tick_format = /^-?(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?( [A-Za-z]+)?$/;
		// the shape frappe-charts prints with its own shortener, such as "1.3K"
		const library_shortened_number = /^\d+(\.\d+)?[KMB]$/;
		// the markers frappe-charts leaves at the end of a label it cut short
		const truncation_marker = /( \.\.\.|\.\.)$/;
		// whether `text` is one of frappe-charts' cut-short forms of `label`
		const is_truncation_of = (text, label) =>
			truncation_marker.test(text) && label.startsWith(text.replace(truncation_marker, ""));
		// the Top Owners data this case supplies: long distinct names sharing a prefix, and counts
		// on both sides of the grouping and abbreviation thresholds
		const owner_labels = [
			"Alexandra Fitzgerald",
			"Alexandra Fitzwilliam",
			"Alexandra Fitzsimmons",
			"Bartholomew Gainsborough",
			"Zoe Xu",
		];
		const owner_values = [2000, 1250, 640, 120, 12];
		const owner_value_texts = ["2 K", "1,250", "640", "120", "12"];
		// two labels of equal length that differ only in their final character, which no
		// truncation narrower than the labels themselves keeps apart
		const equal_tail_labels = ["Alexandra Fitzgerald A", "Alexandra Fitzgerald B"];
		// two labels already distinct in their first character, which a plot too narrow for the
		// " ..." form keeps apart with frappe-charts' short ".." form
		const short_marker_labels = ["AAAA", "BBBB"];
		let probe_chart;

		const label_texts = ($widget, axis) =>
			Array.from($widget.find(`.${axis}.axis text`))
				.map((node) => node.textContent)
				.filter((text) => text.trim() !== "");

		const assert_y_axis = ($widget) => {
			const ticks = label_texts($widget, "y");

			expect($widget.find(".y.axis text").first().text(), "first y tick").to.eq("0");
			expect(ticks.length, "labelled y ticks").to.be.greaterThan(1);
			expect(new Set(ticks).size, `distinct y ticks in ${ticks}`).to.eq(ticks.length);
			ticks.forEach((tick) => {
				expect(tick).to.match(tick_format);
				// a trailing zero decimal such as "500.00" is not a tick this axis prints
				expect(tick, "redundant decimals").to.not.match(/\.\d*0\b/);
			});
		};

		const assert_x_axis = ($widget) => {
			const labels = Array.from($widget.find(".x.axis text"))
				.filter((node) => node.textContent.trim() !== "")
				.map((node) => ({
					text: node.textContent,
					rect: node.getBoundingClientRect(),
				}));

			expect(labels.length, "rendered x labels").to.be.greaterThan(0);
			expect(
				new Set(labels.map((label) => label.text)).size,
				`distinct x labels in ${labels.map((label) => label.text)}`
			).to.eq(labels.length);

			labels.forEach((label, index) => {
				labels.slice(index + 1).forEach((other) => {
					const overlapping =
						label.rect.left < other.rect.right && other.rect.left < label.rect.right;
					expect(overlapping, `"${label.text}" overlaps "${other.text}"`).to.be.false;
				});
			});
		};

		const top_owners_widget = () => cy.contains(".dashboard-widget-box", "ToDo Top Owners");

		const rendered_labels = ($widget) =>
			Array.from($widget.find(".x.axis text"))
				.filter((node) => node.textContent.trim() !== "")
				.map((node) => ({ text: node.textContent, rect: node.getBoundingClientRect() }));

		// every rendered label is one whole supplied label, the rendered labels are distinct and
		// clear of each other, and the last supplied label is on the axis
		const assert_thinned_labels = (labels, supplied, where) => {
			const texts = labels.map((label) => label.text);

			texts.forEach((text) => {
				expect(supplied, `complete label "${text}" ${where}`).to.include(text);
				expect(text, `truncated label "${text}" ${where}`).to.not.contain("...");
			});
			expect(new Set(texts).size, `distinct labels in ${texts} ${where}`).to.eq(
				texts.length
			);
			expect(texts, `last supplied label ${where}`).to.include(
				supplied[supplied.length - 1]
			);

			labels.forEach((label, index) => {
				labels.slice(index + 1).forEach((other) => {
					const overlapping =
						label.rect.left < other.rect.right && other.rect.left < label.rect.right;
					expect(overlapping, `"${label.text}" overlaps "${other.text}" ${where}`).to.be
						.false;
				});
			});
		};

		const assert_owner_value_labels = (where) =>
			top_owners_widget()
				.find("text.data-point-value")
				.should(($values) => {
					const texts = Array.from($values).map((node) => node.textContent);

					expect(texts, `values printed over the bars ${where}`).to.deep.eq(
						owner_value_texts
					);
					texts.forEach((text) => {
						expect(text, `library-shortened value "${text}" ${where}`).to.not.match(
							library_shortened_number
						);
					});
				});

		const assert_owner_labels = (least, where) => {
			top_owners_widget()
				.find("svg.frappe-chart")
				.find("animate, animateTransform")
				.should("have.length", 0);
			top_owners_widget().should(($widget) => {
				const labels = rendered_labels($widget);

				expect(labels.length, `rendered owner labels ${where}`).to.be.at.least(least);
				assert_thinned_labels(labels, owner_labels, where);
			});
		};

		// `count` consecutive days in the MM-DD-YYYY label shape of the dashboard's trend chart
		const probe_labels = (count) =>
			Array.from({ length: count }, (_, index) => {
				const day = new Date(Date.UTC(2024, 0, 1));

				day.setUTCDate(day.getUTCDate() + index);

				return [
					String(day.getUTCMonth() + 1).padStart(2, "0"),
					String(day.getUTCDate()).padStart(2, "0"),
					day.getUTCFullYear(),
				].join("-");
			});

		// Renders `count` labels through the shipped density code into a container
		// `container_width` pixels wide, asserts the axis frappe-charts draws from it, and takes
		// the probe back out of the document.
		const assert_probe_axis = (count, container_width) => {
			const labels = probe_labels(count);
			const where = `for ${count} labels in ${container_width}px`;

			cy.window().then((win) => {
				const element = win.document.createElement("div");

				element.className = "blitzy-axis-probe";
				element.style.width = `${container_width}px`;
				element.style.position = "relative";
				win.document.body.appendChild(element);

				probe_chart = win.frappe.utils.make_chart(element, {
					type: "line",
					data: {
						labels,
						datasets: [{ name: "Probe", values: labels.map((_, index) => index + 1) }],
					},
				});
			});

			// one text node per label, which the placeholder draw carries one fewer of
			cy.get(".blitzy-axis-probe svg.frappe-chart g.x.axis text").should(
				"have.length",
				count
			);
			cy.get(".blitzy-axis-probe svg.frappe-chart")
				.find("animate, animateTransform")
				.should("have.length", 0);
			cy.get(".blitzy-axis-probe svg.frappe-chart g.x.axis text").should(($texts) => {
				const rendered = Array.from($texts)
					.filter((node) => node.textContent.trim() !== "")
					.map((node) => ({
						text: node.textContent,
						rect: node.getBoundingClientRect(),
					}));

				expect(rendered.length, `rendered labels ${where}`).to.be.at.least(1);
				assert_thinned_labels(rendered, labels, where);
			});

			cy.window().then((win) => {
				probe_chart.destroy();
				probe_chart = null;
				win.document
					.querySelectorAll(".blitzy-axis-probe")
					.forEach((element) => element.remove());
			});
		};

		// Renders `labels` into a container `container_width` pixels wide with the ratio
		// `get_axis_label_space_ratio` returns for a non-series axis, asserts the axis
		// frappe-charts draws from that ratio, and takes the probe back out of the document.
		// `truncated` is whether the allowance that ratio carries is narrower than the labels.
		const assert_non_series_probe_axis = (labels, container_width, truncated) => {
			const where = `for ${labels.length} non-series labels in ${container_width}px`;

			cy.window().then((win) => {
				const element = win.document.createElement("div");

				element.className = "blitzy-axis-probe";
				element.style.width = `${container_width}px`;
				element.style.position = "relative";
				win.document.body.appendChild(element);

				const plot_width = win.frappe.utils.get_chart_plot_width(element.clientWidth);
				const ratio = win.frappe.utils.get_axis_label_space_ratio(
					labels,
					plot_width,
					false
				);
				const series_ratio = win.frappe.utils.get_axis_label_space_ratio(
					labels,
					plot_width,
					true
				);

				expect(plot_width, `plot width ${where}`).to.be.greaterThan(0);
				expect(Number.isFinite(ratio), `finite non-series ratio ${ratio} ${where}`).to.be
					.true;
				expect(ratio, `non-series label space ratio ${where}`).to.be.greaterThan(0);
				// the non-series allowance per label is wider than the series one, which thins
				// the labels to one per stride (RA-3)
				expect(
					ratio,
					`non-series ratio ${ratio} over series ratio ${series_ratio} ${where}`
				).to.be.greaterThan(series_ratio);

				probe_chart = win.frappe.utils.make_chart(element, {
					type: "line",
					data: {
						labels,
						datasets: [{ name: "Probe", values: labels.map((_, index) => index + 1) }],
					},
					axisOptions: { xIsSeries: 0, seriesLabelSpaceRatio: ratio },
				});
			});

			// one text node per label, which the placeholder draw carries one fewer of
			cy.get(".blitzy-axis-probe svg.frappe-chart g.x.axis text").should(
				"have.length",
				labels.length
			);
			cy.get(".blitzy-axis-probe svg.frappe-chart")
				.find("animate, animateTransform")
				.should("have.length", 0);
			cy.get(".blitzy-axis-probe svg.frappe-chart g.x.axis text").should(($texts) => {
				const texts = Array.from($texts).map((node) => node.textContent);

				texts.forEach((text) => {
					// a non-series axis blanks no label: it truncates the ones that do not fit
					expect(text.trim(), `label text "${text}" ${where}`).to.not.eq("");
					expect(
						labels.some((label) => label === text || is_truncation_of(text, label)),
						`whole or truncated label "${text}" ${where}`
					).to.be.true;
				});
				expect(new Set(texts).size, `distinct labels in ${texts} ${where}`).to.eq(
					texts.length
				);
				expect(
					texts.some((text) => truncation_marker.test(text)),
					`truncated labels in ${texts} ${where}`
				).to.eq(truncated);
			});

			cy.window().then((win) => {
				probe_chart.destroy();
				probe_chart = null;
				win.document
					.querySelectorAll(".blitzy-axis-probe")
					.forEach((element) => element.remove());
			});
		};

		cy.viewport(1400, 960);
		cy.intercept(
			"POST",
			"**/frappe.desk.dashboard_chart_source.todo_top_owners.todo_top_owners.get",
			(req) =>
				req.reply({
					body: {
						message: {
							labels: owner_labels,
							datasets: [{ name: "Open ToDos", values: owner_values }],
						},
					},
				})
		).as("top_owners");
		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.wait("@top_owners");
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);

		assert_owner_value_labels("at 1400px");
		assert_owner_labels(owner_labels.length, "at 1400px");

		cy.get(".dashboard-widget-box").each(($widget) => {
			cy.wrap($widget).should(assert_y_axis).and(assert_x_axis);
		});

		// the label set this chart renders while it is wide
		let wide_x_labels;
		chart_widget(trend_chart).then(($widget) => {
			wide_x_labels = label_texts($widget, "x");
		});

		// the x labels are re-thinned for the narrower chart
		cy.viewport(375, 800);
		chart_widget(trend_chart)
			.find("svg.frappe-chart")
			.should(($svg) => expect($svg[0].getBoundingClientRect().width).to.be.lessThan(375));

		// the debounced resize has re-applied the label density (RA-4)
		chart_widget(trend_chart).should(($widget) => {
			expect(
				label_texts($widget, "x"),
				`x labels re-thinned from ${wide_x_labels}`
			).to.not.deep.equal(wide_x_labels);
		});

		cy.get(".dashboard-widget-box").each(($widget) => {
			cy.wrap($widget).should(assert_y_axis).and(assert_x_axis);
		});

		assert_owner_value_labels("at 375px");
		assert_owner_labels(1, "at 375px");

		cy.window().then((win) => {
			expect(win.frappe.utils.format_chart_axis_number(0)).to.eq("0");
			expect(win.frappe.utils.format_chart_axis_number(1250)).to.match(/^1,250$/);
			expect(win.frappe.utils.format_chart_axis_number(0.30000000000000004)).to.eq("0.3");
			expect(win.frappe.utils.format_chart_axis_number(100)).to.eq("100");
			expect(win.frappe.utils.format_chart_axis_number(1500000)).to.match(/^1\.5 M$/);
			expect(win.frappe.utils.format_chart_axis_number("")).to.eq("");

			const format_tick = (value) => win.frappe.utils.format_chart_axis_number(value);
			const site_number_format = win.frappe.boot.sysdefaults.number_format;
			// the separator a tick carries between its whole part and its decimals, with any
			// number system symbol taken off first
			const tick_decimal_separator = (text) =>
				(text.replace(/ [A-Za-z]+$/, "").match(/\d(\D)\d{1,2}$/) || [])[1];
			// the sub-cent intervals frappe-charts generates
			const quarter_cent_ticks = [0, 0.0025, 0.005, 0.0075, 0.01].map(format_tick);
			const half_cent_ticks = [0, 0.005, 0.01, 0.015, 0.02].map(format_tick);

			expect(quarter_cent_ticks, "quarter-cent interval ticks").to.deep.eq([
				"0",
				"0.0025",
				"0.005",
				"0.0075",
				"0.01",
			]);
			expect(
				new Set(quarter_cent_ticks).size,
				`distinct ticks in ${quarter_cent_ticks}`
			).to.eq(quarter_cent_ticks.length);
			expect(new Set(half_cent_ticks).size, `distinct ticks in ${half_cent_ticks}`).to.eq(
				half_cent_ticks.length
			);
			expect(format_tick(0.0000005), "half-microcent tick").to.eq("5e-7");
			expect(format_tick(2.5e-7), "tick with a coefficient decimal").to.eq("2.5e-7");
			expect(format_tick(-0.0025), "negative sub-cent tick").to.eq("-0.0025");
			expect(format_tick(0.00012345), "tick kept to three significant digits").to.eq(
				"0.000123"
			);
			expect(format_tick(1250000), "two-decimal abbreviated tick").to.eq("1.25 M");
			expect(
				tick_decimal_separator(format_tick(1250000)),
				"decimal separator of an abbreviated tick"
			).to.eq(tick_decimal_separator(format_tick(12345.678)));

			try {
				win.frappe.boot.sysdefaults.number_format = "#.###,##";
				expect(format_tick(1250), "grouped tick under #.###,##").to.eq("1.250");
				expect(format_tick(12345.678), "decimal tick under #.###,##").to.eq("12.345,68");
				expect(format_tick(0.0025), "sub-cent tick under #.###,##").to.eq("0,0025");
				expect(format_tick(2.5e-7), "scientific tick under #.###,##").to.eq("2,5e-7");
				expect(format_tick(1500000), "abbreviated tick under #.###,##").to.eq("1,5 M");
				expect(format_tick(1250000), "two-decimal abbreviated tick under #.###,##").to.eq(
					"1,25 M"
				);
				expect(
					tick_decimal_separator(format_tick(1250000)),
					"decimal separator of an abbreviated tick under #.###,##"
				).to.eq(tick_decimal_separator(format_tick(12345.678)));

				win.frappe.boot.sysdefaults.number_format = "#,##,###.##";
				expect(format_tick(1234567), "grouped tick under #,##,###.##").to.eq("12,34,567");

				win.frappe.boot.sysdefaults.number_format = "#,###";
				expect(format_tick(0.0025), "sub-cent tick under #,###").to.eq("0.0025");
			} finally {
				win.frappe.boot.sysdefaults.number_format = site_number_format;
			}

			expect(win.frappe.boot.sysdefaults.number_format, "restored site number format").to.eq(
				site_number_format
			);
		});

		cy.viewport(1400, 960);

		[8, 31].forEach((count) => {
			[375, 768].forEach((container_width) => assert_probe_axis(count, container_width));
		});

		// the non-series return of get_axis_label_space_ratio: the truncation allowance widened
		// until the truncated labels are as many distinct texts as the labels themselves, and the
		// full width of the longest label when no allowance below it is
		assert_non_series_probe_axis(owner_labels, 375, true);
		assert_non_series_probe_axis(equal_tail_labels, 300, false);
		assert_non_series_probe_axis(short_marker_labels, 120, true);

		cy.get(".blitzy-axis-probe").should("have.length", 0);

		cy.window().then((win) => {
			const options = win.frappe.utils.get_axis_label_options(
				probe_labels(31),
				win.frappe.utils.get_chart_plot_width(768)
			);

			expect(options.xIsSeries, "x labels thinned as a series").to.eq(1);
			expect(options.seriesLabelSpaceRatio, "label space ratio").to.be.greaterThan(0);
			expect(
				win.frappe.utils.get_axis_label_options([], 768),
				"options without measurable labels"
			).to.deep.eq({});
		});
	});

	it("re-renders the trend chart on every time-window change and keeps focus on the control", () => {
		// start from the chart record's own window, whatever this user last selected
		cy.visit("/desk");
		cy.window()
			.its("frappe")
			.then((frappe) =>
				frappe.xcall(
					"frappe.desk.doctype.dashboard_settings.dashboard_settings.save_chart_config",
					{ reset: 1, config: {}, chart_name: "ToDo Created vs Completed" }
				)
			);

		cy.intercept(
			"POST",
			"**/api/method/frappe.desk.dashboard_chart_source.todo_created_vs_completed.todo_created_vs_completed.get"
		).as("trend");

		cy.visit("/desk/dashboard-view/ToDo Analytics");

		const trend_widget = () => chart_widget(trend_chart);
		const top_owners_widget = () => chart_widget(top_owners_chart);
		const request_args = (interception) => {
			const body = interception.request.body;
			return typeof body === "string" ? JSON.parse(body) : body;
		};

		let week_label_count;
		let month_label_count;
		let top_owners_svg;

		// the render on page load answers the first interception
		cy.wait("@trend");
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);

		trend_widget()
			.find(".x.axis text")
			.should("have.length", 8)
			.then(($labels) => {
				week_label_count = $labels.length;
			});

		top_owners_widget().find("rect.bar").should("have.length.at.least", 1);
		// no entry-animation nodes left in the sibling chart (RB-7)
		top_owners_widget()
			.find("svg.frappe-chart")
			.find("animate, animateTransform")
			.should("have.length", 0);

		// the markup snapshotted is the one this widget has stopped changing on its own: it is
		// read until it has been the same string for two seconds
		let settling_top_owners_svg = null;
		let top_owners_changed_at = null;
		top_owners_widget()
			.find("svg.frappe-chart")
			.should(($svg) => {
				const markup = $svg[0].outerHTML;
				const read_at = Date.now();

				if (markup !== settling_top_owners_svg) {
					settling_top_owners_svg = markup;
					top_owners_changed_at = read_at;
				}

				expect(
					read_at - top_owners_changed_at,
					"ms the Top Owners markup has been unchanged"
				).to.be.at.least(2000);
			});
		cy.then(() => {
			top_owners_svg = settling_top_owners_svg;
		});

		// a timespan selection fetches the chosen window and redraws the axis
		trend_widget().find('.timespan-filter [data-toggle="dropdown"]').click();
		trend_widget().find(".timespan-filter .dropdown-item").contains("Last Month").click();

		cy.wait("@trend").then((interception) => {
			expect(request_args(interception).timespan).to.equal("Last Month");
		});

		trend_widget()
			.find(".x.axis text")
			.should("have.length.at.least", 28)
			.then(($labels) => {
				month_label_count = $labels.length;
				expect($labels.length).to.be.greaterThan(week_label_count);
			});
		trend_widget().find(".timespan-filter .filter-label").should("have.text", "Last Month");
		trend_widget().find('.timespan-filter [data-toggle="dropdown"]').should("have.focus");

		// an interval selection fetches the chosen grain within the selected window
		trend_widget().find('.time-interval-filter [data-toggle="dropdown"]').click();
		trend_widget().find(".time-interval-filter .dropdown-item").contains("Weekly").click();

		cy.wait("@trend").then((interception) => {
			const args = request_args(interception);
			expect(args.time_interval).to.equal("Weekly");
			expect(args.timespan).to.equal("Last Month");
		});

		trend_widget()
			.find(".x.axis text")
			.should(($labels) => {
				expect($labels.length).to.be.lessThan(month_label_count);
			});
		trend_widget().find(".time-interval-filter .filter-label").should("have.text", "Weekly");
		trend_widget().find('.time-interval-filter [data-toggle="dropdown"]').should("have.focus");

		// the other widget keeps its own render and carries no time-window control
		top_owners_widget().find(".timespan-filter").should("have.length", 0);
		top_owners_widget()
			.find("svg.frappe-chart")
			.should(($svg) => {
				expect($svg[0].outerHTML).to.equal(top_owners_svg);
			});

		// the arguments of the most recent trend request, retried until they match
		const last_trend_args = (assert_args) =>
			cy.get("@trend.all").should((interceptions) => {
				expect(interceptions.length, "trend requests").to.be.greaterThan(0);
				assert_args(request_args(interceptions[interceptions.length - 1]));
			});

		// the settings of the most recent answered write, retried until they match
		const last_saved_window = (assert_config) =>
			cy.get("@save_config.all").should((interceptions) => {
				expect(interceptions.length, "settings writes").to.be.greaterThan(0);

				const last = interceptions[interceptions.length - 1];
				expect(last.response && last.response.statusCode, "write answered").to.equal(200);
				assert_config(request_args(last).config);
			});

		// the entry the server holds for this chart in this user's Dashboard Settings
		const persisted_window = (chart_name) =>
			cy.get_doc("Dashboard Settings", "Administrator").then((settings) => {
				const chart_config = JSON.parse(settings.data.chart_config || "{}");
				return chart_config[chart_name] || {};
			});

		cy.intercept(
			"POST",
			"**/api/method/frappe.desk.doctype.dashboard_settings.dashboard_settings.save_chart_config"
		).as("save_config");

		// the daily grain the date-range cases below are counted in
		trend_widget().find('.time-interval-filter [data-toggle="dropdown"]').click();
		trend_widget().find(".time-interval-filter .dropdown-item").contains("Daily").click();

		last_trend_args((args) => {
			expect(args.time_interval).to.equal("Daily");
			expect(args.timespan).to.equal("Last Month");
		});

		trend_widget()
			.find(".x.axis text")
			.should(($labels) => {
				expect($labels.length).to.equal(month_label_count);
			});

		// an unsaved Select Date Range choice survives a rebuild of the action area
		trend_widget().find('.timespan-filter [data-toggle="dropdown"]').click();
		trend_widget()
			.find(".timespan-filter .dropdown-item")
			.contains("Select Date Range")
			.click();
		trend_widget().find(".dashboard-date-field input").should("exist");
		cy.clear_datepickers();

		trend_widget().find(".chart-menu").click();
		trend_widget().find('.chart-actions [data-action="action-refresh"]').click();
		last_trend_args((args) => expect(args.timespan).to.equal("Select Date Range"));

		trend_widget()
			.find(".timespan-filter .filter-label")
			.should("have.text", "Select Date Range");
		trend_widget()
			.find('.timespan-filter .dropdown-item[data-option="Select%20Date%20Range"]')
			.should("have.attr", "aria-checked", "true");
		trend_widget().find(".dashboard-date-field").should("exist");

		// the range typed into the control is fetched, drawn and persisted as one window
		const type_date_range = (range) => {
			cy.window().then((win) => {
				const from = win.frappe.datetime.str_to_user(range.from, false, true);
				const to = win.frappe.datetime.str_to_user(range.to, false, true);

				// the control reads a range typed as two comma-separated dates
				trend_widget()
					.find(".dashboard-date-field input")
					.type(`{selectall}{del}${from},${to}`, { force: true })
					.should("have.value", `${from},${to}`)
					.trigger("change");
			});
			cy.clear_datepickers();
		};

		const assert_window = (range) => (args) => {
			expect(args.timespan).to.equal("Select Date Range");
			expect(args.from_date).to.equal(range.from);
			expect(args.to_date).to.equal(range.to);
		};

		const first_range = {};
		const second_range = {};

		cy.window().then((win) => {
			const today = win.frappe.datetime.now_date();
			Object.assign(first_range, {
				from: win.moment(today).add(-2, "days").format("YYYY-MM-DD"),
				to: today,
			});
			Object.assign(second_range, {
				from: win.moment(today).add(-4, "days").format("YYYY-MM-DD"),
				to: today,
			});
		});

		type_date_range(first_range);

		last_trend_args((args) => assert_window(first_range)(args));
		trend_widget().find(".x.axis text").should("have.length", 3);
		last_saved_window((config) => assert_window(first_range)(config));
		persisted_window("ToDo Created vs Completed").then((entry) => {
			assert_window(first_range)(entry);
		});

		// the saved range is on the control again after a reload, and editing it then keeps the
		// timespan it was saved with
		cy.reload();

		trend_widget()
			.find(".timespan-filter .filter-label")
			.should("have.text", "Select Date Range");
		trend_widget()
			.find(".dashboard-date-field input")
			.should(($input) => {
				expect($input.val(), "range restored from Dashboard Settings").to.not.be.empty;
			});
		trend_widget().find(".x.axis text").should("have.length", 3);
		last_trend_args((args) => assert_window(first_range)(args));

		type_date_range(second_range);

		last_trend_args((args) => assert_window(second_range)(args));
		trend_widget().find(".x.axis text").should("have.length", 5);
		last_saved_window((config) => assert_window(second_range)(config));
		persisted_window("ToDo Created vs Completed").then((entry) => {
			assert_window(second_range)(entry);
		});

		// Reset Chart returns the widget to the chart record's own window
		trend_widget().find(".chart-menu").click();
		trend_widget().find('.chart-actions [data-action="action-reset"]').click();

		last_trend_args((args) => {
			expect(args.timespan).to.equal("Last Week");
			expect(args.time_interval).to.equal("Daily");
		});

		trend_widget()
			.find(".x.axis text")
			.should(($labels) => {
				expect($labels.length).to.equal(week_label_count);
			});
		trend_widget().find(".timespan-filter .filter-label").should("have.text", "Last Week");
		trend_widget().find(".time-interval-filter .filter-label").should("have.text", "Daily");

		// the date-range control is gone and the header it made room for is back
		trend_widget().find(".dashboard-date-field").should("not.exist");
		trend_widget().find(".widget-title").should("be.visible");
		trend_widget().find(".widget-head").should("have.css", "flex-direction", "row");

		// two instances of one timeseries configuration, and one whose record carries a range
		const fixture_dashboard = "Cypress Time Window";
		const fixture_charts = ["Cypress Trend One", "Cypress Trend Two", "Cypress Trend Range"];
		const fixture_requests = [];
		const record_range = {};

		// scoped by title, which a widget keeps through every header layout of this case
		const fixture_widget = (chart_name) =>
			cy.get(`.dashboard-widget-box:has(.widget-title:contains("${chart_name}"))`).first();

		// the arguments of the most recent request for one fixture chart
		const last_fixture_args = (chart_name, assert_args) =>
			cy.wrap(fixture_requests).should((requests) => {
				const for_chart = requests.filter((args) => args.chart_name === chart_name);
				expect(for_chart.length, `requests for ${chart_name}`).to.be.greaterThan(0);
				assert_args(for_chart[for_chart.length - 1]);
			});

		const reset_fixture_config = () =>
			cy
				.window()
				.its("frappe")
				.then((frappe) =>
					Promise.all(
						fixture_charts.map((chart_name) =>
							frappe.xcall(
								"frappe.desk.doctype.dashboard_settings.dashboard_settings.save_chart_config",
								{ reset: 1, config: {}, chart_name: chart_name }
							)
						)
					)
				);

		// fixture records a run that stopped before its cleanup may have left behind
		cy.remove_doc("Dashboard", fixture_dashboard, true);
		fixture_charts.forEach((chart_name) => {
			cy.remove_doc("Dashboard Chart", chart_name, true);
		});

		cy.window().then((win) => {
			const today = win.frappe.datetime.now_date();
			Object.assign(record_range, {
				from: win.moment(today).add(-3, "days").format("YYYY-MM-DD"),
				to: today,
			});
		});

		// the fixture records are registered for the afterEach cleanup
		cy.then(() => {
			const fixture_chart_record = (chart_name, window_fields = {}) =>
				Object.assign(
					{
						chart_name: chart_name,
						chart_type: "Custom",
						source: "ToDo Created vs Completed",
						document_type: "ToDo",
						type: "Line",
						timeseries: 1,
						time_interval: "Daily",
						timespan: "Last Week",
						filters_json: "[]",
						is_standard: 0,
					},
					window_fields
				);

			seed_doc("Dashboard Chart", fixture_chart_record("Cypress Trend One"));
			seed_doc("Dashboard Chart", fixture_chart_record("Cypress Trend Two"));
			seed_doc(
				"Dashboard Chart",
				fixture_chart_record("Cypress Trend Range", {
					timespan: "Select Date Range",
					from_date: record_range.from,
					to_date: record_range.to,
				})
			);
			seed_doc("Dashboard", {
				dashboard_name: fixture_dashboard,
				is_standard: 0,
				charts: fixture_charts.map((chart_name) => ({
					chart: chart_name,
					width: "Half",
				})),
			});
		});

		reset_fixture_config();

		cy.intercept(
			"POST",
			"**/api/method/frappe.desk.dashboard_chart_source.todo_created_vs_completed.todo_created_vs_completed.get",
			(req) => {
				fixture_requests.push(
					typeof req.body === "string" ? JSON.parse(req.body) : req.body
				);
			}
		).as("fixture_trend");

		cy.visit(`/desk/dashboard-view/${fixture_dashboard}`);
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 3);

		// both instances of the same configuration render the record's own window
		["Cypress Trend One", "Cypress Trend Two"].forEach((chart_name) => {
			fixture_widget(chart_name).find(".x.axis text").should("have.length", 8);
			fixture_widget(chart_name)
				.find(".timespan-filter .filter-label")
				.should("have.text", "Last Week");
			fixture_widget(chart_name)
				.find(".time-interval-filter .filter-label")
				.should("have.text", "Daily");
		});

		// the record's own date range reaches the control, the drawn chart and the request
		fixture_widget("Cypress Trend Range")
			.find(".timespan-filter .filter-label")
			.should("have.text", "Select Date Range");
		cy.window().then((win) => {
			const from = win.frappe.datetime.str_to_user(record_range.from, false, true);
			const to = win.frappe.datetime.str_to_user(record_range.to, false, true);

			fixture_widget("Cypress Trend Range")
				.find(".dashboard-date-field input")
				.should(($input) => {
					const value = $input.val();
					expect(value, "range from the chart record").to.not.be.empty;
					expect(value).to.contain(from);
					expect(value).to.contain(to);
				});
		});
		fixture_widget("Cypress Trend Range").find(".x.axis text").should("have.length", 4);
		last_fixture_args("Cypress Trend Range", (args) => {
			expect(args.timespan).to.equal("Select Date Range");
			expect(args.from_date).to.equal(record_range.from);
			expect(args.to_date).to.equal(record_range.to);
		});

		// the date field takes a header row of its own on this narrow widget, leaving the title
		// and subtitle visible, and Reset Chart returns the header to one row
		fixture_widget("Cypress Trend One").find(".widget-title").should("be.visible");
		fixture_widget("Cypress Trend One")
			.find('.timespan-filter [data-toggle="dropdown"]')
			.click();
		fixture_widget("Cypress Trend One")
			.find(".timespan-filter .dropdown-item")
			.contains("Select Date Range")
			.click();
		fixture_widget("Cypress Trend One").find(".dashboard-date-field input").should("exist");
		fixture_widget("Cypress Trend One").find(".widget-title").should("be.visible");
		fixture_widget("Cypress Trend One").should("have.class", "date-range-header");
		fixture_widget("Cypress Trend One").then(($widget) => {
			const title = $widget.find(".widget-title")[0].getBoundingClientRect();
			const control = $widget.find(".dashboard-date-field")[0].getBoundingClientRect();

			expect(
				control.top - title.bottom,
				"date range control below the title row"
			).to.be.at.least(-1);
		});
		cy.clear_datepickers();

		fixture_widget("Cypress Trend One").find(".chart-menu").click();
		fixture_widget("Cypress Trend One")
			.find('.chart-actions [data-action="action-reset"]')
			.click();

		fixture_widget("Cypress Trend One").find(".dashboard-date-field").should("not.exist");
		fixture_widget("Cypress Trend One").find(".widget-title").should("be.visible");
		fixture_widget("Cypress Trend One").should("not.have.class", "date-range-header");
		fixture_widget("Cypress Trend One").find(".x.axis text").should("have.length", 8);

		// a window changed on one instance is neither read nor written by the other
		fixture_widget("Cypress Trend One")
			.find('.timespan-filter [data-toggle="dropdown"]')
			.click();
		fixture_widget("Cypress Trend One")
			.find(".timespan-filter .dropdown-item")
			.contains("Last Month")
			.click();

		last_fixture_args("Cypress Trend One", (args) => {
			expect(args.timespan).to.equal("Last Month");
		});
		fixture_widget("Cypress Trend One")
			.find(".x.axis text")
			.should("have.length.of.at.least", 28);
		fixture_widget("Cypress Trend One")
			.find(".timespan-filter .filter-label")
			.should("have.text", "Last Month");
		fixture_widget("Cypress Trend One")
			.find('.timespan-filter .dropdown-item[data-option="Last%20Month"]')
			.should("have.attr", "aria-checked", "true");

		fixture_widget("Cypress Trend Two").find(".x.axis text").should("have.length", 8);
		fixture_widget("Cypress Trend Two")
			.find(".timespan-filter .filter-label")
			.should("have.text", "Last Week");
		fixture_widget("Cypress Trend Two")
			.find('.timespan-filter .dropdown-item[data-option="Last%20Week"]')
			.should("have.attr", "aria-checked", "true");
		fixture_widget("Cypress Trend Two")
			.find('.timespan-filter .dropdown-item[data-option="Last%20Month"]')
			.should("have.attr", "aria-checked", "false");

		// the sibling re-renders from its own window, not from the window just changed
		fixture_widget("Cypress Trend Two").find(".chart-menu").click();
		fixture_widget("Cypress Trend Two")
			.find('.chart-actions [data-action="action-refresh"]')
			.click();

		cy.wrap(fixture_requests).should((requests) => {
			const for_sibling = requests.filter((args) => args.chart_name === "Cypress Trend Two");
			expect(for_sibling.length, "requests for the sibling instance").to.be.at.least(2);
			for_sibling.forEach((args) => {
				expect(
					args.timespan === null || args.timespan === "Last Week",
					`sibling timespan ${args.timespan}`
				).to.be.true;
			});
		});

		fixture_widget("Cypress Trend Two").find(".x.axis text").should("have.length", 8);
		fixture_widget("Cypress Trend Two")
			.find(".timespan-filter .filter-label")
			.should("have.text", "Last Week");
		fixture_widget("Cypress Trend Two")
			.find('.timespan-filter .dropdown-item[data-option="Last%20Week"]')
			.should("have.attr", "aria-checked", "true");

		persisted_window("Cypress Trend Two").then((entry) => {
			expect(entry.timespan, "sibling persisted timespan").to.not.equal("Last Month");
		});
	});

	it("recovers from a chart data error with the retry affordance", () => {
		let fail_next_trend_request = true;
		let empty_next_trend_request = false;

		cy.intercept(
			"POST",
			"**/frappe.desk.dashboard_chart_source.todo_created_vs_completed.todo_created_vs_completed.get",
			(req) => {
				if (fail_next_trend_request) {
					fail_next_trend_request = false;
					req.reply({
						statusCode: 500,
						body: {
							exc_type: "ValidationError",
							_server_messages: JSON.stringify([
								JSON.stringify({ message: "Simulated chart failure" }),
							]),
						},
					});
				} else if (empty_next_trend_request) {
					empty_next_trend_request = false;
					req.reply({ statusCode: 200, body: { message: {} } });
				}
			}
		).as("trend");

		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.window().then((win) => {
			win.__unitC_no_reload = true;
		});

		const trend_widget = () => chart_widget(trend_chart);
		const owners_widget = () => chart_widget(top_owners_chart);

		cy.wait("@trend", { timeout: 30000 });
		trend_widget().should("contain.text", "ToDo Created vs Completed");

		// the failed fetch shows the message in an announced region beside a Retry control
		trend_widget()
			.find(".chart-loading-state.text-danger")
			.should("be.visible")
			.and("contain.text", "Simulated chart failure");
		trend_widget().find(".chart-error-message").should("have.attr", "role", "alert");
		trend_widget().find("button.chart-retry").should("have.length", 1).and("be.visible");
		trend_widget().find("svg.frappe-chart").should("not.exist");
		owners_widget().find(".chart-loading-state.text-danger").should("not.be.visible");

		// clicking Retry re-fetches the data and restores the chart
		trend_widget().find("button.chart-retry").click();
		cy.wait("@trend", { timeout: 30000 });
		trend_widget().find("svg.frappe-chart").should("have.length", 1);
		trend_widget().find(".chart-loading-state.text-danger").should("not.be.visible");

		// a second failure renders the error state again without duplicating the control
		cy.then(() => {
			fail_next_trend_request = true;
		});
		trend_widget().find(".chart-menu").click();
		trend_widget().find('[data-action="action-refresh"]').click();
		cy.wait("@trend", { timeout: 30000 });
		trend_widget().find("button.chart-retry").should("have.length", 1);
		trend_widget()
			.find(".chart-loading-state.text-danger")
			.should("be.visible")
			.and("contain.text", "Simulated chart failure");

		// the Retry control is operable from the keyboard alone
		trend_widget().find("button.chart-retry").focus();
		cy.focused()
			.should("have.class", "chart-retry")
			.and("have.attr", "aria-label", "Retry loading ToDo Created vs Completed")
			.trigger("keydown", { key: "Enter", keyCode: 13, which: 13 });
		cy.wait("@trend", { timeout: 30000 });
		trend_widget().find("svg.frappe-chart").should("have.length", 1);
		trend_widget().find(".chart-loading-state.text-danger").should("not.be.visible");
		owners_widget().find(".chart-loading-state.text-danger").should("not.be.visible");

		// focus lands on the chart's action menu instead of the document body
		cy.focused().should("have.class", "chart-menu");

		// with no action menu — as in customize mode — focus still lands on a visible node of the
		// widget and not on the hidden Retry control or the document body
		cy.then(() => {
			fail_next_trend_request = true;
		});
		trend_widget().find(".chart-menu").click();
		trend_widget().find('[data-action="action-refresh"]').click();
		cy.wait("@trend", { timeout: 30000 });
		trend_widget().find("button.chart-retry").should("be.visible");
		trend_widget()
			.find("button.chart-menu")
			.should("have.length", 1)
			.then(($menu) => {
				$menu.closest(".chart-actions").remove();
			});
		trend_widget().find(".chart-menu").should("not.exist");

		trend_widget().find("button.chart-retry").focus();
		cy.focused().trigger("keydown", { key: "Enter", keyCode: 13, which: 13 });
		cy.wait("@trend", { timeout: 30000 });
		trend_widget().find("svg.frappe-chart").should("have.length", 1);
		trend_widget().find(".chart-loading-state.text-danger").should("not.be.visible");
		cy.focused().should(($focused) => {
			expect(
				$focused.closest(".dashboard-widget-box").text(),
				"focus stayed inside the widget"
			).to.contain(trend_chart);
			expect($focused.is(":visible"), "focused element is visible").to.be.true;
			expect($focused.hasClass("chart-retry"), "focus left the hidden Retry").to.be.false;
			expect($focused.attr("tabindex"), "focused element is focusable").to.not.be.undefined;
		});

		// a retry that recovers into the "No Data" state focuses that container
		cy.then(() => {
			empty_next_trend_request = true;
		});
		trend_widget()
			.find("button.chart-retry")
			.then(($retry) => {
				$retry.trigger("click");
			});
		cy.wait("@trend", { timeout: 30000 });
		trend_widget().find("svg.frappe-chart").should("not.be.visible");
		cy.focused().should(($focused) => {
			expect($focused.hasClass("chart-loading-state"), "focus is the empty state").to.be
				.true;
			expect($focused.attr("tabindex"), "empty state is focusable").to.equal("-1");
			expect($focused.text(), "empty state text").to.contain("No Data");
		});

		// the chart recovered in place: the page was never reloaded
		cy.window().its("__unitC_no_reload").should("eq", true);
	});

	it("widget menus are keyboard operable, mark the selected option and restore focus", () => {
		const key = (name, code) => ({ key: name, keyCode: code, which: code });
		const ENTER = key("Enter", 13);
		const ESCAPE = key("Escape", 27);
		const ARROW_DOWN = key("ArrowDown", 40);
		const END = key("End", 35);

		const timespan_toggle = '.dashboard-widget-box .timespan-filter [data-toggle="dropdown"]';
		const interval_toggle =
			'.dashboard-widget-box .time-interval-filter [data-toggle="dropdown"]';
		const card_toggle = '.number-widget-box .card-actions [data-toggle="dropdown"]';

		const trend_widget = () =>
			cy.contains(".dashboard-widget-box", "ToDo Created vs Completed");

		const select_timespan = (option) => {
			cy.get(timespan_toggle).focus().trigger("keydown", ARROW_DOWN);
			cy.get(".dashboard-widget-box .timespan-filter").should("have.class", "show");
			cy.get(`.dashboard-widget-box .timespan-filter [data-option="${option}"]`)
				.focus()
				.trigger("keydown", ENTER);
		};

		// the accessible name of one element, resolved in the order the accessible name
		// computation applies it: aria-labelledby, aria-label, an associated or wrapping
		// label, then title. A placeholder is not a name and is never read here.
		const accessible_name = (element) => {
			const in_document = element.ownerDocument;
			const labelled_by = element.getAttribute("aria-labelledby");

			if (labelled_by) {
				const from_ids = labelled_by
					.split(/\s+/)
					.map((id) => in_document.getElementById(id))
					.filter(Boolean)
					.map((node) => node.textContent.trim())
					.filter(Boolean)
					.join(" ");

				if (from_ids) {
					return from_ids;
				}
			}

			const aria_label = (element.getAttribute("aria-label") || "").trim();

			if (aria_label) {
				return aria_label;
			}

			const label =
				(element.id && in_document.querySelector(`label[for="${element.id}"]`)) ||
				element.closest("label");

			if (label) {
				return label.textContent.trim();
			}

			return (element.getAttribute("title") || "").trim();
		};

		const assert_only_checked = (menu_selector, label) => {
			cy.get(`${menu_selector} [role="menuitemradio"]`).each(($option) => {
				const expected = $option.text().trim() === label ? "true" : "false";
				expect(
					$option.attr("aria-checked"),
					`aria-checked of ${$option.text().trim()}`
				).to.equal(expected);
			});
			cy.get(`${menu_selector} [role="menuitemradio"][aria-checked="true"]`).should(
				"have.length",
				1
			);
		};

		// marks the toggle the menu is opened from, then activates the named command with Enter
		const activate_chart_command = (label) => {
			trend_widget()
				.find(".chart-menu")
				.then(($toggle) => $toggle.attr("data-stale-toggle", "1"))
				.focus()
				.trigger("keydown", ARROW_DOWN);
			trend_widget().find(".chart-actions").should("have.class", "show");
			trend_widget().find(".chart-actions").contains('[role="menuitem"]', label).focus();
			return cy.focused().should("have.text", label).trigger("keydown", ENTER);
		};

		// asserts the refetch finished, the menu closed and the keyboard sits on the rebuilt toggle
		const assert_focus_on_rebuilt_menu = () => {
			cy.wait("@menu_trend");
			trend_widget().find("svg.frappe-chart").should("have.length", 1);
			trend_widget().find(".chart-actions").should("not.have.class", "show");
			cy.focused()
				.should("have.class", "chart-menu")
				.and("not.have.attr", "data-stale-toggle");
			trend_widget().find(".chart-menu").should("have.focus");
		};

		cy.intercept(
			"POST",
			"**/api/method/frappe.desk.dashboard_chart_source.todo_created_vs_completed.todo_created_vs_completed.get"
		).as("menu_trend");

		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);

		// 1. timespan dropdown: opens from the keyboard, closes on Escape with focus restored,
		// and marks the option that is applied
		cy.get(timespan_toggle).focus().trigger("keydown", ENTER);
		cy.get(".dashboard-widget-box .timespan-filter").should("have.class", "show");
		cy.focused()
			.should("have.attr", "role", "menuitemradio")
			.and("have.text", "Select Date Range");
		cy.focused().trigger("keydown", ARROW_DOWN);
		cy.focused().should("have.text", "Last Year");
		cy.focused().trigger("keydown", ESCAPE);
		cy.get(".dashboard-widget-box .timespan-filter").should("not.have.class", "show");
		cy.focused()
			.should("have.attr", "data-toggle", "dropdown")
			.parent()
			.should("have.class", "timespan-filter");

		select_timespan("Last%20Month");
		cy.get(".dashboard-widget-box .timespan-filter .filter-label").should(
			"have.text",
			"Last Month"
		);
		assert_only_checked(".dashboard-widget-box .timespan-filter", "Last Month");
		cy.focused()
			.should("have.attr", "data-toggle", "dropdown")
			.parent()
			.should("have.class", "timespan-filter");

		// 1b. the "Select Date Range" option puts the keyboard on a date input that carries its
		// own accessible name, and the widget keeps its title while the control is displayed
		select_timespan("Select%20Date%20Range");
		trend_widget().find(".dashboard-date-field input").should("have.focus");
		trend_widget()
			.find(".dashboard-date-field input")
			.then(($input) => {
				const input = $input[0];

				expect(accessible_name(input), "accessible name of the date range input").to.equal(
					"Date Range"
				);
				expect($input.attr("placeholder"), "placeholder of the date range input").to.equal(
					"Date Range"
				);

				// the control's own label is associated with the input it labels
				expect(input.id, "id of the date range input").to.not.equal("");
				const label = input.ownerDocument.querySelector(`label[for="${input.id}"]`);
				expect(Boolean(label), `label for #${input.id}`).to.equal(true);
				expect(label.textContent.trim(), "text of that label").to.equal("Date Range");
			});
		trend_widget().find(".widget-title").should("be.visible");
		cy.clear_datepickers();

		// re-applying "Last Week" marks it and leaves it applied
		select_timespan("Last%20Week");
		cy.get(".dashboard-widget-box .timespan-filter .filter-label").should(
			"have.text",
			"Last Week"
		);
		assert_only_checked(".dashboard-widget-box .timespan-filter", "Last Week");
		trend_widget().find(".dashboard-date-field").should("not.exist");
		trend_widget().find(".x.axis text").should("have.length", 8);

		// 2. interval dropdown: same open, Escape and focus-return cycle, "Daily" marked
		cy.get(interval_toggle).focus().trigger("keydown", ARROW_DOWN);
		cy.get(".dashboard-widget-box .time-interval-filter").should("have.class", "show");
		cy.focused().should("have.attr", "role", "menuitemradio").and("have.text", "Yearly");
		assert_only_checked(".dashboard-widget-box .time-interval-filter", "Daily");
		cy.focused().trigger("keydown", ESCAPE);
		cy.get(".dashboard-widget-box .time-interval-filter").should("not.have.class", "show");
		cy.focused()
			.should("have.attr", "data-toggle", "dropdown")
			.parent()
			.should("have.class", "time-interval-filter");

		// 3. chart actions menu: ArrowDown opens it on the first command, End jumps to the last
		chart_widget(trend_chart).find(".chart-menu").focus();
		cy.focused().trigger("keydown", ARROW_DOWN);
		chart_widget(trend_chart).find(".chart-actions").should("have.class", "show");
		cy.focused().should("have.attr", "role", "menuitem").and("have.text", "Refresh");
		cy.focused().trigger("keydown", END);
		cy.focused().should("have.attr", "role", "menuitem").and("have.text", "ToDo List");
		cy.focused().trigger("keydown", ESCAPE);
		chart_widget(trend_chart).find(".chart-actions").should("not.have.class", "show");
		cy.focused().should("have.class", "chart-menu");

		// 4. card actions menu: Enter opens it, Escape closes it and focus returns to the toggle
		cy.get(card_toggle).first().focus().trigger("keydown", ENTER);
		cy.get(".number-widget-box").first().find(".card-actions").should("have.class", "show");
		cy.focused().should("have.attr", "role", "menuitem");
		cy.focused().trigger("keydown", ESCAPE);
		cy.get(".number-widget-box")
			.first()
			.find(".card-actions")
			.should("not.have.class", "show");
		cy.focused().should("have.attr", "aria-label", "Card Actions");

		// 5. the filter button announces the dialog it opens, not a menu
		cy.get(".dashboard-widget-box .filter-chart")
			.should("have.length", 2)
			.each(($button) => {
				cy.wrap($button).should("have.attr", "aria-haspopup", "dialog");
			});

		// 6. every widget menu is named by its own toggle
		cy.get('.dashboard-widget-box ul[role="menu"], .number-widget-box ul[role="menu"]').each(
			($menu) => {
				const labelled_by = $menu.attr("aria-labelledby");
				expect(labelled_by, "aria-labelledby").to.be.a("string").and.not.equal("");
				expect(
					$menu[0].ownerDocument.getElementById(labelled_by),
					`element labelling the menu (#${labelled_by})`
				).to.not.equal(null);
			}
		);

		// 7. with the trend fetches of the earlier steps consumed, Refresh activated from the
		// keyboard refetches the chart and puts the keyboard on the rebuilt actions toggle
		cy.get("@menu_trend.all").then((calls) => {
			calls.forEach(() => cy.wait("@menu_trend"));
		});
		activate_chart_command("Refresh");
		assert_focus_on_rebuilt_menu();

		// 8. Reset Chart activated from the keyboard returns the widget to the chart record's own
		// window and puts the keyboard on the rebuilt actions toggle
		activate_chart_command("Reset Chart");
		assert_focus_on_rebuilt_menu();
		trend_widget().find(".timespan-filter .filter-label").should("have.text", "Last Week");
		trend_widget().find(".time-interval-filter .filter-label").should("have.text", "Daily");

		// 9. Escape on the actions toggle of a closed menu reaches the document's own handler,
		// which blurs the toggle and leaves the menu closed
		trend_widget().find(".chart-menu").focus();
		cy.focused().should("have.class", "chart-menu").trigger("keydown", ESCAPE);
		trend_widget().find(".chart-actions").should("not.have.class", "show");
		trend_widget().find(".chart-menu").should("not.have.focus");
		cy.focused().should("not.exist");

		// 10. the Edit command routes to the chart's own form, and the close it triggers leaves
		// focus on the activated command instead of pulling it back to the actions toggle
		activate_chart_command("Edit").then(($item) => {
			const focused = $item[0].ownerDocument.activeElement;
			expect(
				Boolean(focused && focused.classList.contains("chart-menu")),
				"focus pulled back to the chart actions toggle"
			).to.equal(false);
			expect(focused, "focus right after the routing command").to.equal($item[0]);
		});
		cy.window()
			.its("frappe")
			.invoke("get_route_str")
			.should("eq", "Form/Dashboard Chart/ToDo Created vs Completed");
		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);
	});

	it("plot-area tooltips are reachable from the keyboard", () => {
		// the trend chart is served a dataset name carrying an ampersand (RE-11)
		const trend_dataset_name = "Created & Reopened";

		cy.intercept(
			"POST",
			"**/frappe.desk.dashboard_chart_source.todo_created_vs_completed.todo_created_vs_completed.get",
			(req) => {
				req.continue((res) => {
					const datasets = res.body && res.body.message && res.body.message.datasets;

					if (datasets && datasets.length) {
						datasets[0].name = trend_dataset_name;
					}
				});
			}
		).as("trend_tooltip");

		// a second Top Owners owner (RE-9)
		seed_doc("ToDo", {
			description: "Cypress keyboard tooltip seed admin",
			allocated_to: "Administrator",
			assigned_by: "Administrator",
		});

		seed_doc("ToDo", {
			description: "Cypress keyboard tooltip seed test user",
			allocated_to: Cypress.config("testUser"),
			assigned_by: "Administrator",
		});

		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);

		const plot_area = '.chart-plot-area[tabindex="0"][role]';
		const announcer = ".chart-tooltip-announcer[aria-live]";
		const expected_tooltip_text = {
			[trend_chart]: /Created|Completed/,
			[top_owners_chart]: /Open ToDos/,
		};

		const key_codes = { ArrowRight: 39, ArrowLeft: 37, Home: 36, End: 35, Escape: 27 };

		const focus_plot_area = (title) => chart_widget(title).find(plot_area).focus();
		const press = (title, key) => {
			focus_plot_area(title);
			cy.focused().trigger("keydown", {
				key: key,
				keyCode: key_codes[key],
				which: key_codes[key],
			});
		};
		const tooltip_title = (title) =>
			chart_widget(title).find(".graph-svg-tip .title").invoke("text");

		// Steps to the first data point once the entry animation has left the chart, re-dispatching
		// the move until the tooltip holds the loaded series (RE-9).
		const reveal_first_point = (title) => {
			chart_widget(title)
				.find("svg.frappe-chart")
				.find("animate, animateTransform")
				.should("have.length", 0);
			focus_plot_area(title);

			let moves = 0;

			chart_widget(title)
				.find(plot_area)
				.should(($plot) => {
					const win = $plot[0].ownerDocument.defaultView;
					const tip = $plot.closest(".dashboard-widget-box").find(".graph-svg-tip")[0];

					// every move after the first returns to the first data point
					const key = moves++ === 0 ? "ArrowRight" : "Home";

					$plot[0].dispatchEvent(
						new win.KeyboardEvent("keydown", {
							key: key,
							keyCode: key_codes[key],
							which: key_codes[key],
							bubbles: true,
							cancelable: true,
						})
					);

					expect(tip.style.opacity).to.equal("1");
					expect(tip.innerText).to.match(expected_tooltip_text[title]);
				});
		};

		[trend_chart, top_owners_chart].forEach((title) => {
			// the plot area is a labelled focus stop
			chart_widget(title)
				.find(plot_area)
				.should(($plot) => {
					expect($plot.attr("role")).to.not.be.empty;
					expect($plot.attr("aria-label")).to.not.be.empty;
				});
			focus_plot_area(title);
			cy.focused().should(($focused) => {
				expect($focused.hasClass("chart-plot-area")).to.be.true;
				expect($focused.closest(".dashboard-widget-box").text()).to.contain(title);
			});

			// ArrowRight reveals the same tooltip the mouse shows
			reveal_first_point(title);
			chart_widget(title)
				.find(".graph-svg-tip")
				.should(($tip) => {
					expect($tip[0].style.opacity).to.equal("1");
					expect($tip[0].innerText.trim()).to.not.be.empty;
					expect($tip[0].innerText).to.match(expected_tooltip_text[title]);
				});

			// the live region carries the tooltip title and a value
			chart_widget(title)
				.find(announcer)
				.should(($announcer) => {
					const widget = $announcer.closest(".dashboard-widget-box")[0];
					const tip = widget.querySelector(".graph-svg-tip");
					const tip_title = tip.querySelector(".title").innerText.trim();
					const value = tip.querySelector(".tooltip-value").innerText.trim();
					const announcement = $announcer.text();

					expect($announcer.attr("aria-live")).to.equal("polite");
					expect(announcement.toUpperCase()).to.contain(tip_title.toUpperCase());
					expect(announcement).to.contain(value);
				});

			// ArrowRight again moves to the next data point
			tooltip_title(title).then((first_title) => {
				press(title, "ArrowRight");
				tooltip_title(title).should("not.equal", first_title);

				// Home returns to the first data point, End jumps to the last one
				press(title, "Home");
				tooltip_title(title).should("equal", first_title);

				press(title, "End");
				tooltip_title(title).then((last_title) => {
					expect(last_title).to.not.equal(first_title);

					// End is clamped to the last data point
					press(title, "End");
					tooltip_title(title).should("equal", last_title);

					chart_widget(title)
						.find(".graph-svg-tip")
						.should(($tip) => {
							expect($tip[0].style.opacity).to.equal("1");
						});

					// Escape hides the tooltip again and keeps the keyboard on the plot area (RE-10)
					press(title, "Escape");
					chart_widget(title)
						.find(".graph-svg-tip")
						.should(($tip) => {
							expect($tip[0].style.opacity).to.equal("0");
						});
					chart_widget(title).find(announcer).should("have.text", "");
					cy.focused().should(($focused) => {
						expect($focused.hasClass("chart-plot-area")).to.be.true;
						expect($focused.closest(".dashboard-widget-box").text()).to.contain(title);
					});
				});
			});
		});

		// the live region carries the dataset name as characters, not as HTML entities (RE-11)
		reveal_first_point(trend_chart);
		chart_widget(trend_chart).should(($widget) => {
			const labels = Array.from(
				$widget[0].querySelectorAll(".graph-svg-tip .tooltip-label")
			).map((node) => node.textContent.trim());
			const announcement = $widget.find(announcer).text();

			expect(labels, "tooltip series labels").to.include(trend_dataset_name);
			expect(announcement, "announcement").to.contain(trend_dataset_name);
			expect(announcement, "announcement").to.not.contain("&amp;");
		});

		// arrow keys on the plot area do not take over the widget dropdowns
		chart_widget(trend_chart)
			.find(".chart-menu")
			.focus()
			.trigger("keydown", { key: "ArrowDown", keyCode: 40, which: 40 })
			.parent()
			.should("have.class", "show");
		chart_widget(trend_chart)
			.find(".chart-menu")
			.trigger("keydown", { key: "Escape", keyCode: 27, which: 27 });

		// the mouse path still reveals the Top Owners tooltip
		chart_widget(top_owners_chart).should(($widget) => {
			const bar = $widget.find("rect.bar")[0];
			const tip = $widget.find(".graph-svg-tip")[0];
			const box = bar.getBoundingClientRect();
			const win = bar.ownerDocument.defaultView;

			bar.dispatchEvent(
				new win.MouseEvent("mousemove", {
					bubbles: true,
					clientX: box.left + box.width / 2,
					clientY: box.top + box.height / 2,
				})
			);

			expect(tip.style.opacity).to.equal("1");
			expect(tip.innerText).to.contain("Open ToDos");
		});
	});

	it("dashboard text and controls meet WCAG AA contrast", () => {
		// Parses #rgb, #rrggbb, #rrggbbaa, rgb() and rgba(), and picks the first
		// colour out of a compound value such as a box-shadow or a shadow token.
		const parse_colour = (value) => {
			const text = (value || "").trim();
			const functional = /rgba?\(([^)]+)\)/.exec(text);
			if (functional) {
				const parts = functional[1]
					.split(/[,/\s]+/)
					.filter((part) => part.length)
					.map(Number);
				return {
					r: parts[0],
					g: parts[1],
					b: parts[2],
					a: parts.length > 3 ? parts[3] : 1,
				};
			}
			const hex = /#([0-9a-f]{3,8})\b/i.exec(text);
			if (!hex) {
				return null;
			}
			let digits = hex[1];
			if (digits.length === 3 || digits.length === 4) {
				digits = digits
					.split("")
					.map((digit) => digit + digit)
					.join("");
			}
			return {
				r: parseInt(digits.slice(0, 2), 16),
				g: parseInt(digits.slice(2, 4), 16),
				b: parseInt(digits.slice(4, 6), 16),
				a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
			};
		};

		const relative_luminance = ({ r, g, b }) => {
			const linear = (value) => {
				const channel = value / 255;
				return channel <= 0.03928
					? channel / 12.92
					: Math.pow((channel + 0.055) / 1.055, 2.4);
			};
			return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
		};

		// WCAG 2.1 contrast ratio, with a translucent foreground composited over
		// the opaque background the browser paints it on.
		const contrast = (foreground, background) => {
			const fg = parse_colour(foreground);
			const bg = parse_colour(background);
			expect(fg, `foreground colour parsed from "${foreground}"`).to.not.be.null;
			expect(bg, `background colour parsed from "${background}"`).to.not.be.null;
			const blended = {
				r: fg.r * fg.a + bg.r * (1 - fg.a),
				g: fg.g * fg.a + bg.g * (1 - fg.a),
				b: fg.b * fg.a + bg.b * (1 - fg.a),
			};
			const luminances = [relative_luminance(blended), relative_luminance(bg)];
			const lighter = Math.max(...luminances);
			const darker = Math.min(...luminances);
			return (lighter + 0.05) / (darker + 0.05);
		};

		// Nearest ancestor that actually paints a background, which is the colour
		// the element's text or focus ring is seen against.
		const effective_background = (win, element) => {
			let node = element;
			while (node && node.nodeType === 1) {
				const painted = win.getComputedStyle(node).backgroundColor;
				if (painted && painted !== "transparent" && painted !== "rgba(0, 0, 0, 0)") {
					return painted;
				}
				node = node.parentElement;
			}
			return "rgb(255, 255, 255)";
		};

		// The theme this spec found active, restored once both passes have run.
		let original_theme = null;

		// The page background each pass measured its text against, keyed by theme.
		const measured_backgrounds = {};

		// Applies a Desk theme through the framework's own switcher, which rewrites the
		// `data-theme` attribute the token blocks key on.
		const apply_theme = (theme) =>
			cy.window().then((win) => {
				win.frappe.ui.set_theme(theme);
				expect(
					win.document.documentElement.getAttribute("data-theme"),
					"active Desk theme"
				).to.equal(theme);
			});

		// Every surface D7 names, measured in the theme that is active when this runs.
		// `ring_width` is the focus-ring geometry that theme's scoped block declares.
		const assert_dashboard_contrast = (theme, ring_width) => {
			// breadcrumb links and the "/" separator generated before each one
			cy.window().then((win) => {
				measured_backgrounds[theme] = win.getComputedStyle(
					win.document.body
				).backgroundColor;

				const links = [...win.document.querySelectorAll(".navbar-breadcrumbs a")];
				expect(links.length, `${theme}: breadcrumb links`).to.be.greaterThan(0);
				links.forEach((link) => {
					const ratio = contrast(
						win.getComputedStyle(link).color,
						effective_background(win, link)
					);
					expect(
						ratio,
						`${theme}: breadcrumb "${link.innerText.trim()}" contrast`
					).to.be.at.least(4.5);
				});

				const separators = links.filter(
					(link) => win.getComputedStyle(link, "::before").content !== "none"
				);
				expect(separators.length, `${theme}: breadcrumb separators`).to.be.greaterThan(0);
				separators.forEach((link) => {
					const ratio = contrast(
						win.getComputedStyle(link, "::before").color,
						effective_background(win, link)
					);
					expect(
						ratio,
						`${theme}: separator before "${link.innerText.trim()}" contrast`
					).to.be.at.least(4.5);
				});
			});

			// placeholder of the date-range input the trend widget reveals
			chart_widget(trend_chart)
				.find('.timespan-filter button[data-toggle="dropdown"]')
				.click();
			chart_widget(trend_chart)
				.find(".timespan-filter .dropdown-item")
				.contains("Select Date Range")
				.click();
			chart_widget(trend_chart).find(".dashboard-date-field input").should("exist");
			cy.window().then((win) => {
				const input = [
					...win.document.querySelectorAll(
						".dashboard-widget-box .dashboard-date-field input"
					),
				].pop();
				const ratio = contrast(
					win.getComputedStyle(input, "::placeholder").color,
					win.getComputedStyle(input).backgroundColor
				);
				expect(ratio, `${theme}: date-range placeholder contrast`).to.be.at.least(4.5);
			});

			// a preset window applied again, which removes the date-range control
			chart_widget(trend_chart)
				.find('.timespan-filter button[data-toggle="dropdown"]')
				.click();
			chart_widget(trend_chart)
				.find(".timespan-filter .dropdown-item")
				.contains("Last Week")
				.click();
			chart_widget(trend_chart)
				.find(".timespan-filter .filter-label")
				.should("have.text", "Last Week");

			// error text, measured while the normally hidden container is shown
			cy.window().then((win) => {
				const error = win
					.$(".dashboard-widget-box .chart-loading-state.text-danger")
					.first()
					.show()
					.text("contrast probe");
				const ratio = contrast(
					win.getComputedStyle(error[0]).color,
					effective_background(win, error[0])
				);
				error.text("").hide();
				expect(ratio, `${theme}: chart error text contrast`).to.be.at.least(4.5);
			});

			// placeholder text of the loading / no-data state
			cy.window().then((win) => {
				const muted = win
					.$(".dashboard-widget-box .chart-loading-state.text-extra-muted")
					.first()
					.show()
					.text("contrast probe");
				const ratio = contrast(
					win.getComputedStyle(muted[0]).color,
					effective_background(win, muted[0])
				);
				muted.text("").hide();
				expect(ratio, `${theme}: chart placeholder text contrast`).to.be.at.least(4.5);
			});

			// focus ring of a widget control: the geometry this theme declares, then its
			// contrast against the widget and its own background
			cy.get(".dashboard-widget-box .chart-menu").first().focus();
			cy.window().then((win) => {
				const control = win.document.querySelector(".dashboard-widget-box .chart-menu");
				const style = win.getComputedStyle(control);
				const collapse = (value) => (value || "").replace(/\s+/g, " ").trim();
				const declared = collapse(style.getPropertyValue("--focus-default"));
				const outline = collapse(style.getPropertyValue("--focus-outline-default"));
				const painted = style.boxShadow;
				const ring = parse_colour(painted) ? painted : declared;
				const widget = effective_background(win, control.closest(".widget"));
				expect(declared, `${theme}: --focus-default geometry`).to.contain(
					`0px 0px 0px ${ring_width}`
				);
				expect(outline, `${theme}: --focus-outline-default geometry`).to.contain(
					`${ring_width} solid`
				);
				expect(
					contrast(ring, widget),
					`${theme}: focus ring contrast against the widget background`
				).to.be.at.least(3);
				expect(
					contrast(ring, style.backgroundColor),
					`${theme}: focus ring contrast against the control background`
				).to.be.at.least(3);
			});

			// tile text of the number cards
			cy.window().then((win) => {
				[
					".number-widget-box .widget-title",
					".number-widget-box .widget-body",
					".dashboard-widget-box .widget-title",
					".dashboard-widget-box .widget-subtitle",
				].forEach((selector) => {
					const element = win.document.querySelector(selector);
					expect(element, `${theme}: ${selector} is rendered`).to.not.be.null;
					const ratio = contrast(
						win.getComputedStyle(element).color,
						effective_background(win, element)
					);
					expect(ratio, `${theme}: ${selector} contrast`).to.be.at.least(4.5);
				});
			});
		};

		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);
		cy.window().then((win) => {
			original_theme = win.frappe.ui.get_current_theme() || "light";
		});

		apply_theme("light");
		assert_dashboard_contrast("light", "2px");
		apply_theme("dark");
		assert_dashboard_contrast("dark", "3px");

		cy.then(() => {
			expect(
				measured_backgrounds.dark,
				"the dark pass measured a repainted page background"
			).to.not.equal(measured_backgrounds.light);

			apply_theme(original_theme);
		});
	});

	it("number card tiles expose a hover and focus affordance", () => {
		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".number-widget-box").should("have.length", 2);

		// every tile carries the class holding the hover treatment and is a named tab stop
		// whose name states the destination its Document Type card opens
		cy.get(".number-widget-box").each(($tile) => {
			cy.wrap($tile)
				.should("have.class", "widget-shadow")
				.and("have.attr", "tabindex", "0")
				.and("have.attr", "role", "link");

			cy.wrap($tile).should(($rendered) => {
				const title = $rendered.find(".widget-title").text().trim();
				expect(title, "tile title").to.match(/\S/);
				expect($rendered.attr("aria-label"), "tile name").to.equal(
					`${title}: open the ToDo list`
				);
			});
		});

		// the loaded stylesheets carry a :hover rule for the tile (RG-4)
		cy.window().then((win) => {
			const selectors = [];
			for (const sheet of win.document.styleSheets) {
				let rules;
				try {
					rules = sheet.cssRules;
				} catch (e) {
					continue;
				}
				for (const rule of rules || []) {
					rule.selectorText && selectors.push(rule.selectorText);
				}
			}

			const hover_rules = selectors.filter((selector) =>
				/number-widget-box[^,{]*:hover|widget-shadow:hover/.test(selector)
			);
			expect(hover_rules, "tile hover rule").to.not.be.empty;
		});

		// focusing the tile changes its rendered border and shadow
		cy.get(".number-widget-box")
			.first()
			.then(($tile) => {
				const win = $tile[0].ownerDocument.defaultView;
				const unfocused = win.getComputedStyle($tile[0]);
				const baseline = {
					box_shadow: unfocused.boxShadow,
					border_color: unfocused.borderColor,
				};

				cy.wrap($tile).focus();
				cy.focused().should("have.attr", "aria-label", $tile.attr("aria-label"));
				cy.wrap($tile).should(($focused) => {
					const focused = win.getComputedStyle($focused[0]);
					expect(focused.boxShadow, "focused box-shadow").to.not.equal(
						baseline.box_shadow
					);
					expect(focused.borderColor, "focused border-color").to.not.equal(
						baseline.border_color
					);
				});
			});

		// Enter on the focused tile opens the list a click on the tile opens
		cy.focused().type("{enter}");
		cy.location("pathname").should("match", /\/desk\/todo/);
		cy.get(".frappe-list").should("be.visible");

		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".number-widget-box").should("have.length", 2);
		cy.window()
			.its("frappe.dashboard.number_card_group.widgets_list.0.card_doc")
			.should("exist");

		// the tile's name follows the card's type and destination, and only a card with a
		// destination carries link semantics
		cy.window().then((win) => {
			const widget = win.frappe.dashboard.number_card_group.widgets_list[0];
			const tile = widget.widget;
			const title = widget.title || widget.label || widget.name;
			const card_doc = widget.card_doc;
			const data = widget.data;

			widget.card_doc = { type: "Report", report_name: "ToDo Report" };
			widget.update_tile_operability();
			expect(tile.attr("aria-label"), "report card name").to.equal(
				`${title}: open the ToDo Report report`
			);

			widget.card_doc = { type: "Document Type", document_type: "System Settings" };
			widget.update_tile_operability();
			expect(tile.attr("aria-label"), "single document type card name").to.equal(
				`${title}: open System Settings`
			);

			widget.card_doc = { type: "Custom" };
			widget.data = { route: ["List", "ToDo"] };
			widget.update_tile_operability();
			expect(tile.attr("aria-label"), "custom card name").to.equal(`${title}: open ToDo`);
			expect(tile.attr("role"), "custom card role").to.equal("link");

			widget.data = { route: "/desk/todo?status=Open" };
			widget.update_tile_operability();
			expect(tile.attr("aria-label"), "custom card path route name").to.equal(
				`${title}: open todo`
			);

			widget.data = {};
			widget.update_tile_operability();
			expect(tile.attr("role"), "routeless card role").to.be.undefined;
			expect(tile.attr("tabindex"), "routeless card tab stop").to.be.undefined;
			expect(tile.attr("aria-label"), "routeless card name").to.be.undefined;

			widget.card_doc = card_doc;
			widget.data = data;
			widget.update_tile_operability();
			expect(tile.attr("aria-label"), "document type card name").to.equal(
				`${title}: open the ToDo list`
			);
		});

		// a tile switched into customize mode after it was rendered drops its link semantics
		// and its key handler
		cy.window().then((win) => {
			const widget = win.frappe.dashboard.number_card_group.widgets_list[0];
			const tile = widget.widget;

			widget.customize(win.frappe.dashboard.number_card_group.options);
			expect(tile.attr("role"), "customize mode role").to.be.undefined;
			expect(tile.attr("tabindex"), "customize mode tab stop").to.be.undefined;
			expect(tile.attr("aria-label"), "customize mode name").to.be.undefined;

			const events = win.$._data(tile[0], "events");
			expect(events && events.keydown, "customize mode tile key handler").to.be.undefined;
		});

		// rebuilding the tile outside customize mode puts them back
		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".number-widget-box").should("have.length", 2);
		cy.get(".number-widget-box")
			.first()
			.should("have.attr", "role", "link")
			.and("have.attr", "tabindex", "0")
			.and("have.attr", "aria-label", "ToDo Total Open: open the ToDo list");
	});

	it("does not write empty dynamic filter values into the widget filter state", () => {
		const card_name = "Cypress Empty Dynamic Filter Card";
		const chart_name = "Cypress Empty Dynamic Filter Chart";
		const dashboard_name = "Cypress Empty Dynamic Filter Dashboard";
		const unset_expression = 'frappe.defaults.get_user_default("no_such_default_key")';
		const set_array_expression = '["Open"]';

		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.window().its("frappe.dashboard_utils").should("exist");

		cy.window().then((win) => {
			// list-shaped state: an evaluated value that is unset omits its whole row
			const list_filters = win.frappe.dashboard_utils.get_all_filters({
				filters_json: JSON.stringify([["ToDo", "status", "=", "Open", false]]),
				dynamic_filters_json: JSON.stringify([
					["ToDo", "allocated_to", "=", "undefined", false],
					["ToDo", "description", "=", "''", false],
					["ToDo", "reference_type", "=", "'   '", false],
					["ToDo", "priority", "=", "'High'", false],
				]),
			});
			expect(list_filters).to.deep.equal([
				["ToDo", "status", "=", "Open", false],
				["ToDo", "priority", "=", "High", false],
			]);

			// dict-shaped state: an evaluated value that is unset writes no key at all
			const dict_filters = win.frappe.dashboard_utils.get_all_filters({
				filters_json: JSON.stringify({ status: "Open" }),
				dynamic_filters_json: JSON.stringify({
					allocated_to: "undefined",
					owner: "null",
					description: "''",
					priority: "'High'",
				}),
			});
			expect(dict_filters).to.deep.equal({ status: "Open", priority: "High" });
			expect(Object.keys(dict_filters)).to.not.include("allocated_to");

			// 0 and false are values, not unset, and are still written
			const zero_filters = win.frappe.dashboard_utils.get_all_filters({
				filters_json: "[]",
				dynamic_filters_json: JSON.stringify([["ToDo", "idx", "=", "0", false]]),
			});
			expect(zero_filters).to.deep.equal([["ToDo", "idx", "=", 0, false]]);
			expect(win.frappe.dashboard_utils.is_unset_filter_value(0)).to.equal(false);
			expect(win.frappe.dashboard_utils.is_unset_filter_value(false)).to.equal(false);
			expect(win.frappe.dashboard_utils.is_unset_filter_value("   ")).to.equal(true);
			expect(win.frappe.dashboard_utils.is_unset_filter_value([])).to.equal(true);

			// an array holding entries is a value: only a zero-length array is unset
			expect(win.frappe.dashboard_utils.is_unset_filter_value([""])).to.equal(false);
			expect(win.frappe.dashboard_utils.is_unset_filter_value([null])).to.equal(false);
			expect(win.frappe.dashboard_utils.is_unset_filter_value([0])).to.equal(false);
			expect(win.frappe.dashboard_utils.is_unset_filter_value([[]])).to.equal(false);

			// list-shaped state: a non-empty array keeps its shape, a zero-length one is dropped
			const array_list_filters = win.frappe.dashboard_utils.get_all_filters({
				filters_json: "[]",
				dynamic_filters_json: JSON.stringify([
					["ToDo", "status", "in", '[""]', false],
					["ToDo", "priority", "in", "[null]", false],
					["ToDo", "reference_type", "in", "[]", false],
				]),
			});
			expect(array_list_filters).to.deep.equal([
				["ToDo", "status", "in", [""], false],
				["ToDo", "priority", "in", [null], false],
			]);

			// dict-shaped state: a non-empty array is written, a zero-length one writes no key
			const array_dict_filters = win.frappe.dashboard_utils.get_all_filters({
				filters_json: JSON.stringify({ status: "Open" }),
				dynamic_filters_json: JSON.stringify({
					priority: '[""]',
					reference_type: "[]",
				}),
			});
			expect(array_dict_filters).to.deep.equal({ status: "Open", priority: [""] });
			expect(Object.keys(array_dict_filters)).to.not.include("reference_type");

			// an invalid expression is still reported instead of being silently dropped
			expect(() =>
				win.frappe.dashboard_utils.get_all_filters({
					dynamic_filters_json: JSON.stringify([
						["ToDo", "status", "=", "( not js", false],
					]),
				})
			).to.throw();
			cy.clear_dialogs();
		});

		// for widgets rendered on a dashboard, the unset filter never reaches the server while
		// the non-empty array filter arrives with its shape
		cy.remove_doc("Dashboard", dashboard_name, true);
		cy.remove_doc("Number Card", card_name, true);
		cy.remove_doc("Dashboard Chart", chart_name, true);

		seed_doc("ToDo", {
			description: "Cypress empty dynamic filter seed",
			allocated_to: "Administrator",
			assigned_by: "Administrator",
		});

		seed_doc("Number Card", {
			label: card_name,
			type: "Document Type",
			document_type: "ToDo",
			function: "Count",
			is_public: 1,
			show_percentage_stats: 0,
			filters_json: JSON.stringify([["ToDo", "status", "=", "Open", false]]),
			dynamic_filters_json: JSON.stringify([
				["ToDo", "allocated_to", "=", unset_expression, false],
				["ToDo", "status", "in", set_array_expression, false],
			]),
		});

		seed_doc("Dashboard Chart", {
			chart_name: chart_name,
			chart_type: "Count",
			document_type: "ToDo",
			based_on: "creation",
			timeseries: 1,
			time_interval: "Daily",
			timespan: "Last Week",
			type: "Line",
			is_public: 1,
			filters_json: JSON.stringify([["ToDo", "status", "=", "Open", false]]),
			dynamic_filters_json: JSON.stringify([
				["ToDo", "allocated_to", "=", unset_expression, false],
				["ToDo", "status", "in", set_array_expression, false],
			]),
		});

		seed_doc("Dashboard", {
			dashboard_name: dashboard_name,
			cards: [{ card: card_name }],
			charts: [{ chart: chart_name, width: "Full" }],
		});

		cy.intercept("POST", "**/frappe.desk.doctype.number_card.number_card.get_result").as(
			"card_result"
		);
		cy.intercept("POST", "**/frappe.desk.doctype.dashboard_chart.dashboard_chart.get").as(
			"chart_result"
		);

		cy.visit(`/desk/dashboard-view/${dashboard_name}`);

		cy.wait("@card_result").then((interception) => {
			expect(interception.request.body.filters).to.deep.equal([
				["ToDo", "status", "=", "Open", false],
				["ToDo", "status", "in", ["Open"], false],
			]);
			expect(interception.response.body.message).to.be.greaterThan(0);
		});

		cy.wait("@chart_result").then((interception) => {
			expect(interception.request.body.filters).to.deep.equal([
				["ToDo", "status", "=", "Open", false],
				["ToDo", "status", "in", ["Open"], false],
			]);
			const values = interception.response.body.message.datasets[0].values;
			expect(Math.max(...values)).to.be.greaterThan(0);
		});

		cy.get(".number-widget-box .widget-title").should("contain.text", card_name);
		cy.get(".number-widget-box .widget-content .number").should("not.have.text", "0");
	});

	it("serves the dashboard with the security response headers and an intact bundle", () => {
		cy.request("/desk/dashboard-view/ToDo Analytics").then((res) => {
			expect(res.status).to.eq(200);
			[
				"x-frame-options",
				"content-security-policy",
				"x-content-type-options",
				"referrer-policy",
			].forEach((h) => expect(res.headers, h).to.have.property(h));
			expect(res.headers["x-content-type-options"]).to.eq("nosniff");
			expect(res.headers["x-frame-options"]).to.eq("SAMEORIGIN");
			expect(res.headers["referrer-policy"]).to.eq("strict-origin-when-cross-origin");
			expect(res.headers["content-security-policy"]).to.match(/frame-ancestors/);
			expect(res.headers["content-security-policy"]).to.not.match(/default-src \*/);
		});

		// the bundle and the chart sources still run under the policy
		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".number-widget-box").should("have.length", 2);
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);
		cy.get(".dashboard-widget-box .chart-loading-state.text-danger").should("not.be.visible");
	});
});
