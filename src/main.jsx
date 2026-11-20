import { createRoot } from 'react-dom/client';
import ProgressiveChallenge from './components/ProgressiveChallenge.jsx';
import './online.css';

createRoot(document.getElementById('root')).render(
  <main className="online-lab">
    <header className="online-header">
      <h1>Hit Dot Clown</h1>
      <p>AI Carnival Challenge</p>
    </header>
    <ProgressiveChallenge browserOnly />
  </main>,
);
