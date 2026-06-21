import React from 'react';
import { createRoot } from 'react-dom/client';
import { Card } from './ReactCard.jsx';

const mount = document.querySelector('[data-card-root]');

if (mount) {
  const props = mount.dataset.props ? JSON.parse(mount.dataset.props) : {};
  createRoot(mount).render(<Card {...props} />);
}
