import { createContext, useContext, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  function push(message, type = 'info') {
    const payload = typeof message === 'string'
      ? { title: message, description: '', type }
      : { title: message.title, description: message.description || '', type: message.type || type };
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, ...payload }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div className={`toast toast--${t.type || 'info'}`} key={t.id}>
            <strong>{t.title}</strong>
            {t.description ? <span>{t.description}</span> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
