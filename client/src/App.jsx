import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import './index.css';

const API_URL = '/api';

function App() {
  const [items, setItems] = useState([]);
  const [url, setUrl] = useState('');
  const [retention, setRetention] = useState(30);
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('lootlook-theme') || 'dark');
  const [viewMode, setViewMode] = useState('grid');
  const [filterDomain, setFilterDomain] = useState('ALL');
  const [selectedItem, setSelectedItem] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { 
      fetchItems(); 
      document.body.className = theme; 
  }, [theme]);

  const getDomain = (url) => {
      try { return new URL(url).hostname.replace('www.', ''); } catch (e) { return 'unknown'; }
  };

  const toggleTheme = () => {
      const newTheme = theme === 'dark' ? 'colorful' : 'dark';
      setTheme(newTheme);
      localStorage.setItem('lootlook-theme', newTheme);
  };

  // --- TREND LOGIC ---
  const getTrend = (current, previous) => {
      if (!previous) return 'neutral';
      if (current < previous) return 'down'; // Good (Price Drop)
      if (current > previous) return 'up';   // Bad (Price Hike)
      return 'neutral';
  };

  const getDiff = (current, previous) => {
      if (!previous || current === previous) return null;
      const diff = Math.abs(current - previous);
      const arrow = current < previous ? '▼' : '▲';
      return `${arrow} ${diff.toLocaleString()}`;
  };

  const fetchItems = async () => {
    try {
      const res = await fetch(`${API_URL}/items`);
      const json = await res.json();
      setItems(json.data);
    } catch (err) { console.error("Fetch failed:", err); }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, retention: parseInt(retention) })
      });
      if (!res.ok) throw new Error("Failed");
      setUrl('');
      fetchItems();
    } catch (err) { alert("Error: " + err.message); }
    setLoading(false);
  };

  const handleDelete = async (id) => {
    if(!confirm("Stop tracking this item?")) return;
    await fetch(`${API_URL}/items/${id}`, { method: 'DELETE' });
    fetchItems();
  };

  const handleUpdate = async (e) => {
      e.preventDefault();
      try {
          await fetch(`${API_URL}/items/${editingItem.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: editingItem.url, retention: parseInt(editingItem.retention_days) })
          });
          setEditingItem(null);
          fetchItems();
      } catch (err) { alert("Update failed"); }
  };

  const handleRefresh = async (id) => {
    setRefreshing(true);
    try {
        const res = await fetch(`${API_URL}/refresh/${id}`, { method: 'POST' });
        if(res.ok) { fetchItems(); if(selectedItem) openHistory(selectedItem); }
    } catch(err) { alert("Network error"); }
    setRefreshing(false);
  };

  const openHistory = async (item) => {
    setSelectedItem(item);
    try {
      const res = await fetch(`${API_URL}/history/${item.id}`);
      const json = await res.json();
      setHistory(json.data.map(p => ({
        date: new Date(p.date).toLocaleDateString(undefined, {month:'short', day:'numeric'}),
        price: p.price
      })));
    } catch (err) { console.error(err); }
  };

  const uniqueDomains = ['ALL', ...new Set(items.map(i => getDomain(i.url)))];
  const filteredItems = filterDomain === 'ALL' ? items : items.filter(i => getDomain(i.url) === filterDomain);

  return (
    <div className={`app-container ${theme}`}>
      <header className="header">
        <div className="brand">
            <img src="/logo.svg" alt="Logo" className="logo-icon" style={{height:'40px', width:'40px', marginRight:'15px'}} />
            <h1>LootLook</h1>
        </div>
        <button className="theme-toggle" onClick={toggleTheme}>{theme === 'dark' ? '☀️ Light' : '🌙 Dark'}</button>
      </header>

      <div className="add-container">
        <form onSubmit={handleAdd} className="add-form">
            <input type="url" placeholder="Paste product link here..." value={url} onChange={(e) => setUrl(e.target.value)} required className="url-input" />
            <div className="controls">
                <select value={retention} onChange={(e) => setRetention(e.target.value)} className="retention-select">
                    <option value="30">30 Days</option>
                    <option value="90">90 Days</option>
                    <option value="365">1 Year</option>
                </select>
                <button type="submit" disabled={loading} className="track-btn">{loading ? '...' : 'Track'}</button>
            </div>
        </form>
      </div>

      <div className="toolbar">
          <div className="filters">
              <label>Filter:</label>
              <select onChange={(e) => setFilterDomain(e.target.value)} value={filterDomain}>
                  {uniqueDomains.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
          </div>
          <div className="view-toggles">
              <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')}>Tiles</button>
              <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')}>List</button>
          </div>
      </div>

      <div className={`items-container ${viewMode}`}>
        {filteredItems.map(item => {
            const trend = getTrend(item.current_price, item.previous_price);
            const diff = getDiff(item.current_price, item.previous_price);
            
            return (
              <div key={item.id} className={`item-card trend-${trend}`}>
                <div className="card-top" onClick={() => openHistory(item)}>
                    <div className="card-image" style={{backgroundImage: `url(${item.image_url})`}}>
                       <div className="history-badge">History</div>
                    </div>
                    <div className="card-info">
                      <h3>{item.name}</h3>
                      <div className="price-row">
                        <span className="price">{item.currency}{item.current_price.toLocaleString()}</span>
                        {/* Trend Badge */}
                        {diff && <span className={`trend-badge ${trend}`}>{diff}</span>}
                      </div>
                      <span className="domain-tag">{getDomain(item.url)}</span>
                    </div>
                </div>
                
                <div className="action-grid">
                    <button className="btn-action check" onClick={() => handleRefresh(item.id)} disabled={refreshing}>{refreshing ? '...' : 'Check'}</button>
                    <a href={item.url} target="_blank" rel="noreferrer" className="btn-action visit">Visit</a>
                    <button className="btn-action edit" onClick={() => setEditingItem(item)}>Edit</button>
                    <button className="btn-action remove" onClick={() => handleDelete(item.id)}>Remove</button>
                </div>
              </div>
            );
        })}
        {items.length === 0 && !loading && <div className="empty-state">No loot tracked yet. Add a link!</div>}
      </div>

      {selectedItem && (
        <div className="modal-overlay" onClick={() => setSelectedItem(null)}>
          <div className="modal-content chart-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Price History</h2>
              <button className="close-icon" onClick={() => setSelectedItem(null)}>×</button>
            </div>
            <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={history}>
                    <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={12} />
                    <YAxis stroke="var(--text-muted)" />
                    <Tooltip contentStyle={{backgroundColor: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text-main)'}} />
                    <Line type="monotone" dataKey="price" stroke="var(--primary)" strokeWidth={3} dot={{r: 4}} />
                  </LineChart>
                </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {editingItem && (
        <div className="modal-overlay" onClick={() => setEditingItem(null)}>
          <div className="modal-content edit-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Edit Item</h2><button className="close-icon" onClick={() => setEditingItem(null)}>×</button></div>
            <form onSubmit={handleUpdate}>
                <label>Tracking URL</label>
                <input className="full-input" value={editingItem.url} onChange={e => setEditingItem({...editingItem, url: e.target.value})} />
                <label>Retention (Days)</label>
                <select className="full-select" value={editingItem.retention_days} onChange={e => setEditingItem({...editingItem, retention_days: e.target.value})}>
                    <option value="30">30 Days</option><option value="90">90 Days</option><option value="365">1 Year</option><option value="9999">Forever</option>
                </select>
                <button type="submit" className="save-btn">Save Changes</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;