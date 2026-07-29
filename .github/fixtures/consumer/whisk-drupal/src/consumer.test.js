describe('generated consumer test stack', () => {
  it('provides the configured jsdom environment', () => {
    document.body.innerHTML = '<main data-consumer-fixture>Ready</main>';

    expect(document.querySelector('[data-consumer-fixture]')?.textContent).toBe(
      'Ready',
    );
  });
});
