import { createRoot } from 'react-dom/client';
document.querySelector("#app").innerHTML = `
<div>
  <h1>Hello TTT</h1>
  </dev>
`;S

// Clear the existing HTML content
document.body.innerHTML = '<div id="app"></div>';

// Render your React component instead
const root = createRoot(document.getElementById('app'));
root.render(<h1>Hello, o splendid universe!</h1>);
