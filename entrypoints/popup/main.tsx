import { createRoot } from 'react-dom/client';
import { App } from '../../src/popup/App';
import '../../src/popup/styles.css';
import React from "react";

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
