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

		// expect both charts to be loaded without an error state
		cy.get(".dashboard-widget-box svg.frappe-chart").should("have.length", 2);
		cy.get(".dashboard-widget-box .chart-loading-state.text-danger").should("not.be.visible");
	});
});
