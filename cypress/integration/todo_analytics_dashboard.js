describe("ToDo Analytics Dashboard", { scrollBehavior: false }, () => {
	before(() => {
		cy.login("Administrator");
		cy.visit("/desk");
	});

	it("renders two cards and two charts", () => {
		cy.insert_doc(
			"ToDo",
			{
				description: "Cypress ToDo Analytics seed one",
				allocated_to: "Administrator",
				assigned_by: "Administrator",
			},
			true
		);

		cy.insert_doc(
			"ToDo",
			{
				description: "Cypress ToDo Analytics seed two",
				allocated_to: "Administrator",
				assigned_by: "Administrator",
			},
			true
		);

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
		cy.get(".dashboard-widget-box")
			.eq(1)
			.should(($widget) => {
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
		cy.get(".dashboard-widget-box")
			.eq(0)
			.find(".chart-menu")
			.focus()
			.trigger("keydown", { key: "ArrowDown", keyCode: 40, which: 40 })
			.parent()
			.should("have.class", "show");
		cy.get(".dashboard-widget-box")
			.eq(0)
			.find(".chart-menu")
			.trigger("keydown", { key: "ArrowDown", keyCode: 40, which: 40 });
		cy.focused().should("have.class", "dropdown-item").and("have.attr", "role", "menuitem");
		cy.focused().trigger("keydown", { key: "Enter", keyCode: 13, which: 13 });
		cy.get(".dashboard-widget-box")
			.eq(0)
			.find(".chart-menu")
			.parent()
			.should("not.have.class", "show");
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);
	});

	it("formats axis ticks consistently and keeps axis labels legible", () => {
		// 0, thousands-separated integers, up to two decimals, or one number system symbol
		const tick_format = /^-?(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?( [A-Za-z]+)?$/;

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

		cy.viewport(1400, 960);
		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);

		cy.get(".dashboard-widget-box").each(($widget) => {
			cy.wrap($widget).should(assert_y_axis).and(assert_x_axis);
		});

		// the x labels are re-thinned for the narrower chart
		cy.viewport(375, 800);
		cy.get(".dashboard-widget-box svg.frappe-chart")
			.first()
			.should(($svg) => expect($svg[0].getBoundingClientRect().width).to.be.lessThan(375));
		cy.wait(1000); // the widget re-applies the label density on a debounced resize

		cy.get(".dashboard-widget-box").each(($widget) => {
			cy.wrap($widget).should(assert_y_axis).and(assert_x_axis);
		});

		cy.window().then((win) => {
			expect(win.frappe.utils.format_chart_axis_number(0)).to.eq("0");
			expect(win.frappe.utils.format_chart_axis_number(1250)).to.match(/^1,250$/);
			expect(win.frappe.utils.format_chart_axis_number(0.30000000000000004)).to.eq("0.3");
			expect(win.frappe.utils.format_chart_axis_number(100)).to.eq("100");
			expect(win.frappe.utils.format_chart_axis_number(1500000)).to.match(/^1\.5 M$/);
			expect(win.frappe.utils.format_chart_axis_number("")).to.eq("");
		});

		cy.viewport(1400, 960);
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

		const trend_widget = () =>
			cy.contains(".dashboard-widget-box", "ToDo Created vs Completed");
		const top_owners_widget = () => cy.contains(".dashboard-widget-box", "ToDo Top Owners");
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
		// wait for the entry animation to finish before snapshotting the markup
		top_owners_widget()
			.find("svg.frappe-chart")
			.find("animate, animateTransform")
			.should("have.length", 0);
		top_owners_widget()
			.find("svg.frappe-chart")
			.then(($svg) => {
				top_owners_svg = $svg[0].outerHTML;
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

		// Reset Chart returns the widget to the chart record's own window
		trend_widget().find(".chart-menu").click();
		trend_widget().find('.chart-actions [data-action="action-reset"]').click();

		cy.wait("@trend").then((interception) => {
			const args = request_args(interception);
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
	});

	it("recovers from a chart data error with the retry affordance", () => {
		let fail_next_trend_request = true;

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
				}
			}
		).as("trend");

		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.window().then((win) => {
			win.__unitC_no_reload = true;
		});

		const trend_widget = () => cy.get(".dashboard-widget-box").eq(0);
		const owners_widget = () => cy.get(".dashboard-widget-box").eq(1);

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

		const select_timespan = (option) => {
			cy.get(timespan_toggle).focus().trigger("keydown", ARROW_DOWN);
			cy.get(".dashboard-widget-box .timespan-filter").should("have.class", "show");
			cy.get(`.dashboard-widget-box .timespan-filter [data-option="${option}"]`)
				.focus()
				.trigger("keydown", ENTER);
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

		// restore the timespan the dashboard was found with
		select_timespan("Last%20Week");
		cy.get(".dashboard-widget-box .timespan-filter .filter-label").should(
			"have.text",
			"Last Week"
		);
		assert_only_checked(".dashboard-widget-box .timespan-filter", "Last Week");

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
		cy.get(".dashboard-widget-box").eq(0).find(".chart-menu").focus();
		cy.focused().trigger("keydown", ARROW_DOWN);
		cy.get(".dashboard-widget-box").eq(0).find(".chart-actions").should("have.class", "show");
		cy.focused().should("have.attr", "role", "menuitem").and("have.text", "Refresh");
		cy.focused().trigger("keydown", END);
		cy.focused().should("have.attr", "role", "menuitem").and("have.text", "ToDo List");
		cy.focused().trigger("keydown", ESCAPE);
		cy.get(".dashboard-widget-box")
			.eq(0)
			.find(".chart-actions")
			.should("not.have.class", "show");
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
	});

	it("plot-area tooltips are reachable from the keyboard", () => {
		// two owners, so moving along the Top Owners axis lands on a different data point
		cy.insert_doc(
			"ToDo",
			{
				description: "Cypress keyboard tooltip seed admin",
				allocated_to: "Administrator",
				assigned_by: "Administrator",
			},
			true
		);

		cy.insert_doc(
			"ToDo",
			{
				description: "Cypress keyboard tooltip seed test user",
				allocated_to: Cypress.config("testUser"),
				assigned_by: "Administrator",
			},
			true
		);

		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);

		const plot_area = '.chart-plot-area[tabindex="0"][role]';
		const announcer = ".chart-tooltip-announcer[aria-live]";
		const expected_tooltip_text = {
			0: /Created|Completed/,
			1: /Open ToDos/,
		};

		const focus_plot_area = (widget_index) =>
			cy.get(".dashboard-widget-box").eq(widget_index).find(plot_area).focus();
		const press = (widget_index, key) => {
			focus_plot_area(widget_index);
			cy.focused().trigger("keydown", { key: key });
		};
		const tooltip_title = (widget_index) =>
			cy
				.get(".dashboard-widget-box")
				.eq(widget_index)
				.find(".graph-svg-tip .title")
				.invoke("text");

		// frappe-charts renders placeholder series during its entry animation; the first keyboard
		// move is repeated until the chart holds the series it was loaded with
		const reveal_first_point = (widget_index, attempt = 0) => {
			press(widget_index, attempt === 0 ? "ArrowRight" : "Home");
			cy.get(".dashboard-widget-box")
				.eq(widget_index)
				.find(".graph-svg-tip")
				.then(($tip) => {
					const revealed =
						$tip[0].style.opacity === "1" &&
						expected_tooltip_text[widget_index].test($tip[0].innerText);

					if (!revealed && attempt < 9) {
						cy.wait(500);
						reveal_first_point(widget_index, attempt + 1);
					}
				});
		};

		[0, 1].forEach((widget_index) => {
			// the plot area is a labelled focus stop
			cy.get(".dashboard-widget-box")
				.eq(widget_index)
				.find(plot_area)
				.should(($plot) => {
					expect($plot.attr("role")).to.not.be.empty;
					expect($plot.attr("aria-label")).to.not.be.empty;
				});
			focus_plot_area(widget_index);
			cy.focused().should(($focused) => {
				const widget = Cypress.$(".dashboard-widget-box")[widget_index];

				expect($focused.hasClass("chart-plot-area")).to.be.true;
				expect(widget.contains($focused[0])).to.be.true;
			});

			// ArrowRight reveals the same tooltip the mouse shows
			reveal_first_point(widget_index);
			cy.get(".dashboard-widget-box")
				.eq(widget_index)
				.find(".graph-svg-tip")
				.should(($tip) => {
					expect($tip[0].style.opacity).to.equal("1");
					expect($tip[0].innerText.trim()).to.not.be.empty;
					expect($tip[0].innerText).to.match(expected_tooltip_text[widget_index]);
				});

			// the live region carries the tooltip title and a value
			cy.get(".dashboard-widget-box")
				.eq(widget_index)
				.find(announcer)
				.should(($announcer) => {
					const widget = Cypress.$(".dashboard-widget-box")[widget_index];
					const tip = widget.querySelector(".graph-svg-tip");
					const title = tip.querySelector(".title").innerText.trim();
					const value = tip.querySelector(".tooltip-value").innerText.trim();
					const announcement = $announcer.text();

					expect($announcer.attr("aria-live")).to.equal("polite");
					expect(announcement.toUpperCase()).to.contain(title.toUpperCase());
					expect(announcement).to.contain(value);
				});

			// ArrowRight again moves to the next data point
			tooltip_title(widget_index).then((first_title) => {
				press(widget_index, "ArrowRight");
				tooltip_title(widget_index).should("not.equal", first_title);

				// Home returns to the first data point, End jumps to the last one
				press(widget_index, "Home");
				tooltip_title(widget_index).should("equal", first_title);

				press(widget_index, "End");
				tooltip_title(widget_index).then((last_title) => {
					expect(last_title).to.not.equal(first_title);

					// End is clamped to the last data point
					press(widget_index, "End");
					tooltip_title(widget_index).should("equal", last_title);

					cy.get(".dashboard-widget-box")
						.eq(widget_index)
						.find(".graph-svg-tip")
						.should(($tip) => {
							expect($tip[0].style.opacity).to.equal("1");
						});

					// Escape hides the tooltip again
					press(widget_index, "Escape");
					cy.get(".dashboard-widget-box")
						.eq(widget_index)
						.find(".graph-svg-tip")
						.should(($tip) => {
							expect($tip[0].style.opacity).to.equal("0");
						});
					cy.get(".dashboard-widget-box")
						.eq(widget_index)
						.find(announcer)
						.should("have.text", "");
				});
			});
		});

		// arrow keys on the plot area do not take over the widget dropdowns
		cy.get(".dashboard-widget-box")
			.eq(0)
			.find(".chart-menu")
			.focus()
			.trigger("keydown", { key: "ArrowDown", keyCode: 40, which: 40 })
			.parent()
			.should("have.class", "show");
		cy.get(".dashboard-widget-box")
			.eq(0)
			.find(".chart-menu")
			.trigger("keydown", { key: "Escape", keyCode: 27, which: 27 });

		// the mouse path still reveals the Top Owners tooltip
		cy.get(".dashboard-widget-box")
			.eq(1)
			.should(($widget) => {
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

		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);

		// breadcrumb links
		cy.window().then((win) => {
			const links = [...win.document.querySelectorAll(".navbar-breadcrumbs a")];
			expect(links.length, "breadcrumb links").to.be.greaterThan(0);
			links.forEach((link) => {
				const ratio = contrast(
					win.getComputedStyle(link).color,
					effective_background(win, link)
				);
				expect(ratio, `breadcrumb "${link.innerText.trim()}" contrast`).to.be.at.least(
					4.5
				);
			});
		});

		// placeholder of the date-range input the trend widget reveals
		cy.get(".dashboard-widget-box")
			.first()
			.find('.timespan-filter button[data-toggle="dropdown"]')
			.click();
		cy.get(".dashboard-widget-box")
			.first()
			.find(".timespan-filter .dropdown-item")
			.contains("Select Date Range")
			.click();
		cy.get(".dashboard-widget-box")
			.first()
			.find(".dashboard-date-field input")
			.should("exist");
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
			expect(ratio, "date-range placeholder contrast").to.be.at.least(4.5);
		});

		// leave Dashboard Settings as they were found
		cy.get(".dashboard-widget-box")
			.first()
			.find('.timespan-filter button[data-toggle="dropdown"]')
			.click();
		cy.get(".dashboard-widget-box")
			.first()
			.find(".timespan-filter .dropdown-item")
			.contains("Last Week")
			.click();
		cy.get(".dashboard-widget-box")
			.first()
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
			expect(ratio, "chart error text contrast").to.be.at.least(4.5);
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
			expect(ratio, "chart placeholder text contrast").to.be.at.least(4.5);
		});

		// focus ring of a widget control, against the widget and its own background
		cy.get(".dashboard-widget-box .chart-menu").first().focus();
		cy.window().then((win) => {
			const control = win.document.querySelector(".dashboard-widget-box .chart-menu");
			const style = win.getComputedStyle(control);
			const declared = style.getPropertyValue("--focus-default");
			const painted = style.boxShadow;
			const ring = parse_colour(painted) ? painted : declared;
			const widget = effective_background(win, control.closest(".widget"));
			expect(
				contrast(ring, widget),
				"focus ring contrast against the widget background"
			).to.be.at.least(3);
			expect(
				contrast(ring, style.backgroundColor),
				"focus ring contrast against the control background"
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
				expect(element, `${selector} is rendered`).to.not.be.null;
				const ratio = contrast(
					win.getComputedStyle(element).color,
					effective_background(win, element)
				);
				expect(ratio, `${selector} contrast`).to.be.at.least(4.5);
			});
		});
	});

	it("number card tiles expose a hover and focus affordance", () => {
		cy.visit("/desk/dashboard-view/ToDo Analytics");
		cy.get(".number-widget-box").should("have.length", 2);

		// every tile carries the class holding the hover treatment and is a named tab stop
		cy.get(".number-widget-box").each(($tile) => {
			cy.wrap($tile)
				.should("have.class", "widget-shadow")
				.and("have.attr", "tabindex", "0")
				.and("have.attr", "role", "link");
			expect($tile.attr("aria-label")).to.match(/\S/);
		});

		// checks that a CSS :hover rule for the tile is loaded: a synthetic mouseover cannot
		// trigger CSS :hover, so the hover path is covered by rule presence while the
		// focus-visible path below is exercised on the element itself
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
	});

	it("does not write empty dynamic filter values into the widget filter state", () => {
		const card_name = "Cypress Empty Dynamic Filter Card";
		const chart_name = "Cypress Empty Dynamic Filter Chart";
		const dashboard_name = "Cypress Empty Dynamic Filter Dashboard";
		const unset_expression = 'frappe.defaults.get_user_default("no_such_default_key")';

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

		// the unset filter also never reaches the server for widgets rendered on a dashboard
		cy.remove_doc("Dashboard", dashboard_name, true);
		cy.remove_doc("Number Card", card_name, true);
		cy.remove_doc("Dashboard Chart", chart_name, true);

		cy.insert_doc(
			"ToDo",
			{
				description: "Cypress empty dynamic filter seed",
				allocated_to: "Administrator",
				assigned_by: "Administrator",
			},
			true
		);

		cy.insert_doc(
			"Number Card",
			{
				label: card_name,
				type: "Document Type",
				document_type: "ToDo",
				function: "Count",
				is_public: 1,
				show_percentage_stats: 0,
				filters_json: JSON.stringify([["ToDo", "status", "=", "Open", false]]),
				dynamic_filters_json: JSON.stringify([
					["ToDo", "allocated_to", "=", unset_expression, false],
				]),
			},
			true
		);

		cy.insert_doc(
			"Dashboard Chart",
			{
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
				]),
			},
			true
		);

		cy.insert_doc(
			"Dashboard",
			{
				dashboard_name: dashboard_name,
				cards: [{ card: card_name }],
				charts: [{ chart: chart_name, width: "Full" }],
			},
			true
		);

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
			]);
			expect(interception.response.body.message).to.be.greaterThan(0);
		});

		cy.wait("@chart_result").then((interception) => {
			expect(interception.request.body.filters).to.deep.equal([
				["ToDo", "status", "=", "Open", false],
			]);
			const values = interception.response.body.message.datasets[0].values;
			expect(Math.max(...values)).to.be.greaterThan(0);
		});

		cy.get(".number-widget-box .widget-title").should("contain.text", card_name);
		cy.get(".number-widget-box .widget-content .number").should("not.have.text", "0");

		cy.remove_doc("Dashboard", dashboard_name, true);
		cy.remove_doc("Number Card", card_name, true);
		cy.remove_doc("Dashboard Chart", chart_name, true);
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
