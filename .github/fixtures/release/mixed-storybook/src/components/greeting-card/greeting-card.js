export class GreetingCardElement extends HTMLElement {
  static observedAttributes = ['featured', 'heading'];

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  set heading(value) {
    this.headingValue = value;
    this.render();
  }

  get heading() {
    return this.headingValue;
  }

  set body(value) {
    this.bodyValue = value;
    this.render();
  }

  get body() {
    return this.bodyValue;
  }

  set featured(value) {
    this.featuredValue = Boolean(value);
    this.render();
  }

  get featured() {
    return this.featuredValue;
  }

  set items(value) {
    this.itemsValue = value;
    this.render();
  }

  get items() {
    return this.itemsValue;
  }

  set optionalNote(value) {
    this.optionalNoteValue = value;
    this.render();
  }

  get optionalNote() {
    return this.optionalNoteValue;
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    const heading = this.headingValue ?? this.getAttribute('heading') ?? '';
    const featured =
      this.featuredValue === undefined
        ? this.hasAttribute('featured')
        : this.featuredValue;
    const items = Array.isArray(this.itemsValue) ? this.itemsValue : [];

    this.shadowRoot.innerHTML = `
      <article
        class="greeting-card"
        data-featured="${String(featured)}"
        data-testid="greeting-card"
      >
        <h2 data-testid="heading">${heading}</h2>
        <p data-testid="body">${this.bodyValue ?? ''}</p>
        <p data-testid="optional-note">${this.optionalNoteValue ?? ''}</p>
        <ul data-testid="items">
          ${items.map(({ label }) => `<li>${label}</li>`).join('')}
        </ul>
        <p><slot data-testid="default-slot"></slot></p>
        <button data-testid="select" type="button">Select greeting</button>
      </article>
    `;

    this.shadowRoot
      .querySelector('[data-testid="select"]')
      .addEventListener('click', () => {
        this.dispatchEvent(
          new CustomEvent('greeting-select', {
            bubbles: true,
            detail: { heading },
          }),
        );
      });
  }
}
