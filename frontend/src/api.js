import axios from 'axios';
const api = axios.create({
  baseURL: 'http://localhost:5001',
  timeout: 0,  // 2 minutes
  withCredentials: true, // IMPORTANT
});
export default api;