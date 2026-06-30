import React from 'react';

export function Card({
  heading = 'React JSX card',
  content = 'Mounted from a JSX entry.',
}) {
  return (
    <article className="card card--react" data-fixture="react-jsx">
      <h2>{heading}</h2>
      <p>{content}</p>
    </article>
  );
}
