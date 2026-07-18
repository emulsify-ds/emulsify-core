export class GreetingCardElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  set heading(value) {
    this.headingText = value;
    this.render();
  }

  set body(value) {
    this.bodyText = value;
    this.render();
  }

  set featured(value) {
    this.featuredValue = Boolean(value);
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <article class="greeting-card" data-featured="${String(
        Boolean(this.featuredValue),
      )}">
        <h2>${this.headingText || ''}</h2>
        <p>${this.bodyText || ''}</p>
        <p><slot></slot></p>
        <button type="button">Select greeting</button>
      </article>
    `;

    this.shadowRoot.querySelector('button').addEventListener('click', () => {
      this.dispatchEvent(
        new CustomEvent('greeting-select', {
          bubbles: true,
          detail: { heading: this.headingText },
        }),
      );
    });
  }
}
