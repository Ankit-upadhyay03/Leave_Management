import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  response => response,
  error => {
    const status = error.response?.status;
    const code = error.response?.data?.error;

    // 401 means the session is gone: expired token, deleted account, or a
    // deactivation that took effect mid-session.
    if (status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');

      const path = window.location.pathname;
      if (path !== '/login') {
        if (code === 'ACCOUNT_DEACTIVATED') {
          sessionStorage.setItem('authMessage', 'Your account has been deactivated. Please contact your administrator.');
        } else {
          sessionStorage.setItem('authMessage', 'Your session has expired. Please sign in again.');
          sessionStorage.setItem('redirectAfterLogin', path);
        }
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;
