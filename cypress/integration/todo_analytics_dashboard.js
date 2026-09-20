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
			.should("have.attr", "role", "menuitem")
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
});
