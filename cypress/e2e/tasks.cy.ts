describe('Tasks', () => {
  before(() => {
    cy.visit('/');
    cy.window().then(win => {
      cy.stub(win, 'prompt').returns('Test Tasks');
    });
    cy.contains('button', 'New').click();
    cy.get('[role="menuitem"]').contains('Task list').click();
    cy.url({ timeout: 15000 }).should('include', '#/tasks/');
    cy.get('[placeholder="Add a task..."]', { timeout: 10000 }).should('exist');
  });

  // Single test to avoid Chromium renderer crashes from memory pressure
  it('task list CRUD', () => {
    // Quick-add a task
    cy.get('[placeholder="Add a task..."]').type('Buy milk');
    cy.contains('button', 'Add').click();
    cy.contains('span', 'Buy milk').should('exist');

    // Add a second task
    cy.get('[placeholder="Add a task..."]').type('Walk the dog{enter}');
    cy.contains('span', 'Walk the dog').should('exist');

    // Toggle task completion via checkbox
    cy.contains('span', 'Buy milk').parent().find('[role="checkbox"]').click();
    cy.contains('span', 'Buy milk').should('have.css', 'opacity', '0.5');

    // Click task title to open editor sheet
    cy.contains('span', 'Walk the dog').click();
    cy.contains('Edit Task').should('be.visible');

    // Edit the title in the sheet
    cy.contains('label', 'Title').parent().find('input').clear().type('Walk the dog in the park');
    cy.contains('button', 'Save').click();
    cy.contains('span', 'Walk the dog in the park').should('exist');

    // Delete completed tasks
    cy.contains('button', 'Delete Completed').click();
    cy.contains('span', 'Buy milk').should('not.exist');
    // Uncompleted task still present
    cy.contains('span', 'Walk the dog in the park').should('exist');
  });
});
