import { io } from 'socket.io-client';

let socket;

export function connectSocket() {
  if (socket) return socket;
  socket = io('/', {
    auth: { token: localStorage.getItem('accessToken') },
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function subscribeJob(jobId, onProgress) {
  const s = connectSocket();
  s.emit('job:subscribe', jobId);
  s.on('job:progress', onProgress);
  return () => {
    s.emit('job:unsubscribe', jobId);
    s.off('job:progress', onProgress);
  };
}
