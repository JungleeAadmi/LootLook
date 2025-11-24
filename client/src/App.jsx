import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import './index.css';

const API_URL = 'http://' + window.location.hostname + ':3001/api';

function App() {
  const [items, setItems] = useState([]);
  const [url, setUrl] = useState('');
  const [retention, setRetention] = useState(30);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [refreshing, setRefreshing] = useState(false); // New state for manual refresh

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    try {
      const res = await fetch(`${API_URL}/items`);
      const json = await res.json();
      setItems(json.data);
    } catch (err) { console.error(err); }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetch(`${API_URL}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, retention: parseInt(retention) })
      });
      setUrl('');
      fetchItems();
    } catch (err) { alert("Error adding item"); }
    setLoading(false);
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if(!confirm("Stop tracking this item?")) return;
    await fetch(`${API_URL}/items/${id}`, { method: 'DELETE' });
    fetchItems();
  };

  // New Force Refresh Function
  const handleRefresh = async (id) => {
    setRefreshing(true);
    try {
        const res = await fetch(`${API_URL}/refresh/${id}`, { method: 'POST' });
        if(res.ok) {
            // Reload history and list
            await openHistory(selectedItem); // Reload chart
            await fetchItems(); // Reload list prices
        } else {
            alert("Refresh failed. Check logs.");
        }
    } catch(err) {
        console.error(err);
        alert("Network error");
    }
    setRefreshing(false);
  };

  const openHistory = async (item) => {
    setSelectedItem(item);
    try {
      const res = await fetch(`${API_URL}/history/${item.id}`);
      const json = await res.json();
      const formatted = json.data.map(p => ({
        date: new Date(p.date).toLocaleDateString(undefined, {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}),
        price: p.price
      }));
      setHistory(formatted);
    } catch (err) { console.error(err); }
  };

  const closeModal = () => {
    setSelectedItem(null);
    setHistory([]);
  };

  return (
    <div className="app-container">
      <header className="header">
        <div className="logo"><span className="logo-icon">🔍</span> LootLook</div>
      </header>

      <div className="add-section">
        <form onSubmit={handleAdd}>
          <div className="input-group">
            <input 
              type="url" 
              placeholder="Paste product link here..." 
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
            <div className="retention-wrapper">
              <label>Keep Data:</label>
              <select value={retention} onChange={(e) => setRetention(e.target.value)}>
                <option value="7">7 Days</option>
                <option value="30">30 Days</option>
                <option value="90">90 Days</option>
                <option value="365">1 Year</option>
              </select>
            </div>
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Scanning...' : 'Track Price'}
          </button>
        </form>
      </div>

      <div className="items-grid">
        {items.map(item => (
          <div key={item.id} className="item-card" onClick={() => openHistory(item)}>
            <div className="card-image" style={{backgroundImage: `url(${item.image_url})`}}>
               <div className="retention-badge">{item.retention_days}d History</div>
            </div>
            <div className="card-content">
              <h3>{item.name}</h3>
              <div className="price-tag">
                <span className="current">{item.currency}{item.current_price}</span>
              </div>
              <div className="meta">
                Last check: {new Date(item.last_checked).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
              </div>
              <button className="delete-btn" onClick={(e) => handleDelete(e, item.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>

      {selectedItem && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{selectedItem.name.substring(0, 30)}...</h2>
              <button className="close-btn" onClick={closeModal}>×</button>
            </div>
            <div className="chart-container">
              {history.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={history}>
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', color: '#fff'}} />
                    <Line type="monotone" dataKey="price" stroke="#38bdf8" strokeWidth={3} dot={{r: 4}} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p>Not enough data for a graph yet.</p>
              )}
            </div>
            <div className="modal-actions" style={{display:'flex', gap:'10px'}}>
                <button 
                    onClick={() => handleRefresh(selectedItem.id)} 
                    disabled={refreshing}
                    style={{flex:1, background: refreshing ? '#64748b' : '#38bdf8'}}
                >
                    {refreshing ? 'Checking...' : 'Check Price Now'}
                </button>
                <a href={selectedItem.url} target="_blank" rel="noreferrer" className="visit-btn" style={{flex:1}}>
                    Visit Store
                </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;