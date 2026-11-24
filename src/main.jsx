import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import ProgressiveChallenge from './components/ProgressiveChallenge.jsx';
import './online.css';

function App() {
  const [esp32Connected, setEsp32Connected] = useState(false);
  return <main className="online-lab">
    <header className="online-header">
      <h1>Hit Dot Clown</h1>
      <div className={'header-device ' + (esp32Connected ? 'connected' : 'disconnected')} role="status">
        <i />ESP32 {esp32Connected ? 'connected' : 'disconnected'}
      </div>
    </header>
    <ProgressiveChallenge browserOnly onControlsChange={({ connected }) => setEsp32Connected(connected)} />
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
