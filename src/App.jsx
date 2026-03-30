import React, { useState } from 'react';
import { ChatLayout } from './features/chat/components/ChatLayout/ChatLayout';
import { Login } from './features/chat/components/Login/Login';
import { getSession, clearSession } from './features/chat/utils/authStorage';

function App() {
  const [session, setSession] = useState(() => getSession());

  const handleLogin = (newSession) => {
    setSession(newSession);
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
  };

  if (!session) {
    return <Login onLogin={handleLogin} />;
  }

  return <ChatLayout session={session} onLogout={handleLogout} />;
}

export default App;
