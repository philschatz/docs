describe('Calendar View', () => {
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  function switchToDayView() {
    cy.get('.sx__view-selection-selected-item').click();
    cy.get('.sx__view-selection-items').contains('Day').click();
    cy.get('.sx__time-grid-day', { timeout: 5000 }).should('exist');
  }

  // Helper: select a value from a Radix UI Select component by trigger ID
  function radixSelect(triggerId: string, label: string) {
    cy.get(`#${triggerId}`).click();
    cy.get('[role="listbox"]').should('be.visible');
    cy.contains('[role="option"]', label).click();
  }

  // Helper: create an event via the UI editor and save it
  function createEventViaUI(title: string, opts: { time?: string; allDay?: boolean; location?: string; description?: string; recurrence?: string } = {}) {
    switchToDayView();
    cy.get('.sx__time-grid-day').click(50, 200, { force: true });
    cy.get('.panel', { timeout: 5000 }).should('be.visible');

    cy.get('#ed-title').clear().type(title);
    cy.get('#ed-date').clear().type(dateStr);

    if (opts.allDay) {
      cy.get('#ed-allday').then($el => {
        if ($el.attr('data-state') !== 'checked') cy.wrap($el).click();
      });
    } else {
      cy.get('#ed-allday').then($el => {
        if ($el.attr('data-state') === 'checked') cy.wrap($el).click();
      });
      if (opts.time) {
        cy.get('#ed-time').clear().type(opts.time);
      }
      cy.get('#ed-duration').clear().type('PT1H');
    }

    if (opts.location) {
      cy.get('#ed-location').clear().type(opts.location);
    }
    if (opts.description) {
      cy.get('#ed-desc').clear().type(opts.description);
    }
    if (opts.recurrence) {
      radixSelect('ed-freq', opts.recurrence);
    }

    cy.get('#ed-save').click();
    cy.get('.panel').should('not.exist');
  }

  before(() => {
    // Create a fresh calendar via the UI
    cy.visit('/#/');
    cy.contains('New calendar').click();
    // Click the newly created calendar link to navigate to it
    cy.get('a[href*="/calendars/"]', { timeout: 10000 }).first().click();
    // Wait for the calendar to render
    cy.get('#sx-cal', { timeout: 15000 }).should('not.be.empty');
  });

  it('renders with a page title containing Calendar', () => {
    cy.title().should('contain', 'Calendar');
  });

  it('hides the loading status after calendar loads', () => {
    cy.get('#status').should('not.exist');
  });

  it('renders the schedule-x calendar container', () => {
    cy.get('#sx-cal').children().should('have.length.greaterThan', 0);
  });

  it('creates a new event via the editor', () => {
    switchToDayView();
    cy.get('.sx__time-grid-day').click(50, 200, { force: true });
    cy.get('.panel').should('be.visible');
    cy.get('.panel h2').should('contain', 'New Event');

    cy.get('#ed-title').type('Brand New Event');
    cy.get('#ed-date').clear().type(dateStr);
    cy.get('#ed-allday').then($el => {
      if ($el.attr('data-state') === 'checked') cy.wrap($el).click();
    });
    cy.get('#ed-time').clear().type('16:00');
    cy.get('#ed-duration').clear().type('PT2H');
    cy.get('#ed-save').click();

    cy.get('.panel').should('not.exist');
    cy.contains('Brand New Event').should('exist');
  });

  it('opens the editor panel when clicking an event', () => {
    createEventViaUI('Click Target', { time: '14:00' });
    cy.contains('Click Target').click({ force: true });

    cy.get('.panel').should('be.visible');
    cy.get('.overlay').should('exist');
    cy.get('#ed-title').should('have.value', 'Click Target');
  });

  it('closes the editor panel when clicking cancel', () => {
    cy.contains('Click Target').click({ force: true });
    cy.get('.panel').should('be.visible');
    cy.get('#ed-cancel').click();
    cy.get('.panel').should('not.exist');
    cy.get('.overlay').should('not.exist');
  });

  it('closes the editor panel when clicking the overlay', () => {
    cy.contains('Click Target').click({ force: true });
    cy.get('.panel').should('be.visible');
    cy.get('.overlay').click({ force: true });
    cy.get('.panel').should('not.exist');
  });

  it('edits an event title through the editor', () => {
    cy.contains('Click Target').click({ force: true });
    cy.get('#ed-title').clear().type('Updated Title');
    cy.get('#ed-save').click();

    cy.get('.panel').should('not.exist');
    cy.contains('Updated Title').should('exist');
  });

  it('shows the all-day checkbox and hides time fields when checked', () => {
    createEventViaUI('All Day Toggle', { time: '09:00' });
    cy.contains('All Day Toggle').click({ force: true });

    cy.get('#time-fields').should('exist');
    cy.get('#ed-allday').click();
    cy.get('#time-fields').should('not.exist');
    cy.get('#ed-allday').click();
    cy.get('#time-fields').should('exist');
    cy.get('#ed-cancel').click();
  });

  it('populates location and description in the editor', () => {
    createEventViaUI('Full Event', { time: '15:00', location: 'Room 42', description: 'Discuss quarterly results' });
    cy.contains('Full Event').click({ force: true });

    cy.get('#ed-location').should('have.value', 'Room 42');
    cy.get('#ed-desc').should('have.value', 'Discuss quarterly results');
    cy.get('#ed-cancel').click();
  });

  it('shows recurrence options when frequency is selected', () => {
    createEventViaUI('Recurrence UI Test', { time: '10:00' });
    cy.contains('Recurrence UI Test').click({ force: true });

    cy.get('#recurrence-opts').should('not.exist');
    radixSelect('ed-freq', 'Weekly');
    cy.get('#recurrence-opts').should('exist');
    cy.get('#weekly-days').should('exist');
    cy.get('.day-btn').should('have.length', 7);

    radixSelect('ed-freq', 'Daily');
    cy.get('#weekly-days').should('not.exist');

    radixSelect('ed-freq', 'None');
    cy.get('#recurrence-opts').should('not.exist');
    cy.get('#ed-cancel').click();
  });

  it('toggles day buttons in weekly recurrence', () => {
    cy.contains('Recurrence UI Test').click({ force: true });

    radixSelect('ed-freq', 'Weekly');
    cy.get('.day-btn').eq(1).click();
    cy.get('.day-btn').eq(1).should('have.class', 'active');
    cy.get('.day-btn').eq(1).click();
    cy.get('.day-btn').eq(1).should('not.have.class', 'active');
    cy.get('#ed-cancel').click();
  });

  it('creates a recurring event and shows it', () => {
    createEventViaUI('Recurring Check', { time: '08:00', recurrence: 'Daily' });
    cy.contains('Recurring Check').should('exist');
  });

  it('shows "Edit Occurrence" when clicking a recurring event instance', () => {
    cy.contains('Recurring Check').first().click({ force: true });
    cy.get('.panel h2').should('contain', 'Edit Occurrence');
    cy.contains('Edit all events').should('exist');
    cy.get('#ed-cancel').click();
  });

  it('switches to edit-all mode for a recurring event', () => {
    cy.contains('Recurring Check').first().click({ force: true });
    cy.get('.panel h2').should('contain', 'Edit Occurrence');

    cy.contains('Edit all events').click();
    cy.get('.panel h2').should('contain', 'Edit Event');
    cy.get('#ed-freq').should('contain.text', 'Daily');
    cy.get('#ed-cancel').click();
  });

  it('shows recurrence end options (count and until)', () => {
    createEventViaUI('End Options', { time: '11:00' });
    cy.contains('End Options').click({ force: true });
    radixSelect('ed-freq', 'Daily');

    cy.get('#ed-ends').should('contain.text', 'Never');
    cy.get('#end-count').should('not.exist');
    cy.get('#end-until').should('not.exist');

    radixSelect('ed-ends', 'After');
    cy.get('#end-count').should('exist');
    cy.get('#ed-count').should('exist');

    radixSelect('ed-ends', 'On date');
    cy.get('#end-until').should('exist');
    cy.get('#ed-until').should('exist');
    cy.get('#ed-cancel').click();
  });

  it('renders an all-day event in the date grid strip', () => {
    createEventViaUI('All Day Meeting', { allDay: true });
    cy.get('.sx__date-grid-event', { timeout: 10000 }).should('exist');
    cy.contains('All Day Meeting').should('exist');
  });
});
