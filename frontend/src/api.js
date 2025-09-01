import axios from 'axios';
const api = axios.create({
  baseURL: 'https://ship-inspect-1.onrender.com',
  timeout: 0,  // 2 minutes
  withCredentials: true, // IMPORTANT
});
export default api;
