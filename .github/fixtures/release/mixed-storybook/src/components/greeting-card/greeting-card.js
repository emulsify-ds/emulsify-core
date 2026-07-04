export class GreetingCardElement extends HTMLElement {
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
    this.innerHTML = `
      <article class="greeting-card" data-featured="${String(
        Boolean(this.featuredValue),
      )}">
        <h2>${this.headingText || ''}</h2>
        <p>${this.bodyText || ''}</p>
      </article>
    `;
  }
}
