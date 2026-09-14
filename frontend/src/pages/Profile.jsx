import { useAuth } from '../context/AuthContext';

export default function Profile() {
  const { user } = useAuth();
  return (
    <div>
      <h2 className="page-title">Profile</h2>
      <div className="card" style={{ maxWidth: 480 }}>
        <p><strong>Name:</strong> {user.firstName} {user.lastName}</p>
        <p><strong>Email:</strong> {user.email}</p>
        <p><strong>Role:</strong> {user.role}</p>
        <p><strong>Status:</strong> {user.status}</p>
        <p><strong>User code:</strong> {user.userCode}</p>
      </div>
    </div>
  );
}
