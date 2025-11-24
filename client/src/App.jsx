import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import './index.css';

const API_URL = '/api';

function App() {
  const [items, setItems] = useState([]);
  const [url, setUrl] = useState('');
  const [retention, setRetention] = useState(30);
  const [loading, setLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    try {
      const res = await fetch(`${API_URL}/items`);
      if (!res.ok) throw new Error("Server error");
      const json = await res.json();
      setItems(json.data);
    } catch (err) { console.error("Fetch failed:", err); }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setLoading(true);

    const timeout = setTimeout(() => {
        setLoading(false);
        alert("Server took too long. Check logs.");
    }, 60000);

    try {
      const res = await fetch(`${API_URL}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, retention: parseInt(retention) })
      });
      
      clearTimeout(timeout);
      
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to add");
      }
      
      setUrl('');
      fetchItems();
    } catch (err) { 
      clearTimeout(timeout);
      alert("Error: " + err.message); 
    }
    setLoading(false);
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if(!confirm("Stop tracking this item?")) return;
    await fetch(`${API_URL}/items/${id}`, { method: 'DELETE' });
    fetchItems();
  };

  const handleRefresh = async (id) => {
    setRefreshing(true);
    try {
        const res = await fetch(`${API_URL}/refresh/${id}`, { method: 'POST' });
        if(res.ok) {
            if(selectedItem) openHistory(selectedItem);
            fetchItems();
        } else {
            alert("Refresh failed.");
        }
    } catch(err) { alert("Network error"); }
    setRefreshing(false);
  };

  const openHistory = async (item) => {
    setSelectedItem(item);
    try {
      const res = await fetch(`${API_URL}/history/${item.id}`);
      const json = await res.json();
      const formatted = json.data.map(p => ({
        date: new Date(p.date).toLocaleDateString(undefined, {month:'short', day:'numeric'}),
        price: p.price
      }));
      setHistory(formatted);
    } catch (err) { console.error(err); }
  };

  return (
    <div className="app-container">
      {/* HEADER SECTION */}
      <header className="header">
        <div className="brand">
            {/* FIXED: Inline styles force the size, ignoring cache issues */}
            <img 
                src="/logo.svg" 
                alt="Logo" 
                className="logo-icon" 
                style={{ height: '50px', width: '50px', marginRight: '15px' }} 
            />
            <h1>LootLook</h1>
        </div>
      </header>

      {/* SEARCH/ADD SECTION */}
      <div className="add-container">
        <form onSubmit={handleAdd} className="add-form">
            <input 
              type="url" 
              placeholder="Paste product link here..." 
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              className="url-input"
            />
            <div className="controls">
                <select 
                    value={retention} 
                    onChange={(e) => setRetention(e.target.value)}
                    className="retention-select"
                >
                    <option value="30">Keep 30 Days</option>
                    <option value="90">Keep 90 Days</option>
                    <option value="365">Keep 1 Year</option>
                </select>
                <button type="submit" disabled={loading} className="track-btn">
                    {loading ? 'Scanning...' : 'Track Price'}
                </button>
            </div>
        </form>
      </div>

      {/* ITEMS GRID */}
      <div className="items-grid">
        {items.map(item => (
          <div key={item.id} className="item-card" onClick={() => openHistory(item)}>
            <div className="card-image" style={{backgroundImage: `url(${item.image_url})`}}>
               <div className="history-badge">Click for History</div>
            </div>
            <div className="card-details">
              <h3>{item.name}</h3>
              <div className="price-row">
                {/* Shows currency correctly */}
                <span className="price">{item.currency}{item.current_price}</span>
                <span className="date">Checked: {new Date(item.last_checked).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
              </div>
              <button className="delete-btn" onClick={(e) => handleDelete(e, item.id)}>Remove</button>
            </div>
          </div>
        ))}
        {items.length === 0 && !loading && <div className="empty-state">No loot tracked yet. Add a link above!</div>}
      </div>

      {/* HISTORY MODAL */}
      {selectedItem && (
        <div className="modal-overlay" onClick={() => setSelectedItem(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Price History</h2>
              <button className="close-icon" onClick={() => setSelectedItem(null)}>×</button>
            </div>
            <div className="chart-wrapper">
              {history.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={history}>
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip contentStyle={{backgroundColor: '#1e293b', border: 'none', color: '#fff'}} />
                    <Line type="monotone" dataKey="price" stroke="#38bdf8" strokeWidth={3} dot={{r: 4}} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <p className="no-data">Collecting data...</p>}
            </div>
            <div className="modal-actions">
                <button onClick={() => handleRefresh(selectedItem.id)} disabled={refreshing} className="refresh-btn">
                    {refreshing ? 'Updating...' : 'Check Price Now'}
                </button>
                <a href={selectedItem.url} target="_blank" rel="noreferrer" className="visit-btn">
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