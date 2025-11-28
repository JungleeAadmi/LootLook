import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import io from 'socket.io-client';
import './index.css';

const API_URL = '/api';
const socket = io(); 

function App() {
  const [items, setItems] = useState([]);
  const [url, setUrl] = useState('');
  const [retention, setRetention] = useState(30);
  const [loading, setLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState(null);
  const [theme, setTheme] = useState(localStorage.getItem('lootlook-theme') || 'dark');
  const [filterDomain, setFilterDomain] = useState('ALL');
  const [selectedItem, setSelectedItem] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [checkingAll, setCheckingAll] = useState(false); 
  const [globalSync, setGlobalSync] = useState(false);

  useEffect(() => { 
      fetchItems(); 
      document.body.className = theme; 
      
      socket.on('REFRESH_DATA', () => { fetchItems(); });
      
      const onFocus = () => fetchItems();
      window.addEventListener('focus', onFocus);
      return () => {
          window.removeEventListener('focus', onFocus);
          socket.off('REFRESH_DATA');
      };
  }, [theme]);

  const getDomain = (url) => {
      try { return new URL(url).hostname.replace('www.', ''); } catch (e) { return 'unknown'; }
  };

  const toggleTheme = () => {
      const newTheme = theme === 'dark' ? 'colorful' : 'dark';
      setTheme(newTheme);
      localStorage.setItem('lootlook-theme', newTheme);
  };

  const fetchItems = async () => {
    setGlobalSync(true);
    try {
      const res = await fetch(`${API_URL}/items`);
      const json = await res.json();
      setItems(json.data);
    } catch (err) { console.error("Fetch failed:", err); }
    setTimeout(() => setGlobalSync(false), 800);
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
      if (!res.ok) throw new Error("Failed to add");
      setUrl('');
    } catch (err) { alert(err.message); }
    setLoading(false);
  };

  const handleDelete = async (id) => {
    if(!confirm("Delete this item?")) return;
    await fetch(`${API_URL}/items/${id}`, { method: 'DELETE' });
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
      } catch (err) { alert("Update failed"); }
  };

  const handleRefresh = async (id) => {
    setRefreshingId(id);
    try {
        // Trigger backend refresh
        const res = await fetch(`${API_URL}/refresh/${id}`, { method: 'POST' });
        if(res.ok) { 
            // If the item currently being viewed is refreshed, update graph
            if(selectedItem?.id === id) openHistory(items.find(i => i.id === id)); 
        } else {
            console.error("Refresh failed on server");
        }
    } catch(err) { alert("Network error"); }
    setRefreshingId(null);
  };

  const handleCheckAll = async () => {
      if (checkingAll) return;
      if (!confirm(`Check all ${items.length} items?`)) return;
      setCheckingAll(true);
      for (const item of items) {
          try { await fetch(`${API_URL}/refresh/${item.id}`, { method: 'POST' }); } 
          catch (e) { console.error(e); }
      }
      setCheckingAll(false);
      alert("Completed!");
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => alert("Copied!"));
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

  const getTrend = (c, p) => (!p || c === p) ? 'neutral' : (c < p ? 'down' : 'up');
  const domains = [...new Set(items.map(i => getDomain(i.url)))].sort((a, b) => a.localeCompare(b));
  const uniqueDomains = ['ALL', ...domains];
  const filteredItems = filterDomain === 'ALL' ? items : items.filter(i => getDomain(i.url) === filterDomain);

  return (
    <div className={`app-wrapper ${theme}`}>
      <nav className="navbar">
        <div className="nav-content">
            <div className="brand">
                <div className="logo-box">
                    <img src="/logo.svg" alt="Logo" className="logo-icon" />
                </div>
                <span className="brand-name">LootLook</span>
            </div>
            <div className="nav-actions">
                <button className={`nav-btn ${checkingAll ? 'pulse' : ''}`} onClick={handleCheckAll} title="Check All">⚡</button>
                <button className={`nav-btn ${globalSync ? 'spin' : ''}`} onClick={fetchItems} title="Sync">↻</button>
                <button className="nav-btn theme-btn" onClick={toggleTheme}>{theme === 'dark' ? '☀️' : '🌙'}</button>
            </div>
        </div>
      </nav>

      <main className="main-content">
        <section className="controls-panel">
            <form onSubmit={handleAdd} className="add-bar">
                <input type="url" placeholder="Paste product link here..." value={url} onChange={(e) => setUrl(e.target.value)} required className="main-input" />
                <div className="add-actions">
                    <select value={retention} onChange={(e) => setRetention(e.target.value)} className="main-select">
                        <option value="30">30 Days</option><option value="90">90 Days</option><option value="365">1 Year</option>
                    </select>
                    <button type="submit" disabled={loading} className="primary-btn">{loading ? 'Adding...' : 'Track'}</button>
                </div>
            </form>
            <div className="filter-bar">
                <label>Filter:</label>
                <select onChange={(e) => setFilterDomain(e.target.value)} value={filterDomain} className="filter-select">
                    {uniqueDomains.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
            </div>
        </section>

        <section className="items-grid">
            {filteredItems.map(item => (
                <article key={item.id} className={`item-card trend-${getTrend(item.current_price, item.previous_price)}`}>
                    <div className="card-media" onClick={() => openHistory(item)}>
                        <div className="img-bg" style={{backgroundImage: `url(${item.image_url})`}}></div>
                        <span className="graph-tag">Graph</span>
                    </div>
                    <div className="card-body">
                        <h3 onClick={() => openHistory(item)}>{item.name}</h3>
                        <div className="price-box">
                            <span className="currency">{item.currency}</span>
                            <span className="amount">{item.current_price.toLocaleString()}</span>
                        </div>
                        <div className="meta-info">
                            <span className="badge">{getDomain(item.url)}</span>
                            <span className="badge">{item.date_added ? new Date(item.date_added).toLocaleDateString(undefined, {day:'2-digit', month:'short'}) : 'N/A'}</span>
                        </div>
                    </div>
                    <div className="card-actions">
                        <button onClick={() => handleRefresh(item.id)} disabled={refreshingId === item.id} className="action-btn check">
                            {refreshingId === item.id ? '...' : 'Check'}
                        </button>
                        <a href={item.url} target="_blank" rel="noreferrer" className="action-btn visit">Visit</a>
                        <button onClick={() => setEditingItem(item)} className="action-btn edit">Edit</button>
                        <button onClick={() => handleDelete(item.id)} className="action-btn remove">Remove</button>
                    </div>
                </article>
            ))}
            {items.length === 0 && !loading && <div className="empty-state">No items yet. Add one above!</div>}
        </section>
      </main>

      {/* Modals */}
      {selectedItem && (
        <div className="modal-backdrop" onClick={() => setSelectedItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>History</h3><button onClick={() => setSelectedItem(null)}>×</button></div>
            <div className="modal-body graph-body">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={history}><XAxis dataKey="date" stroke="currentColor" fontSize={12} /><YAxis stroke="currentColor" /><Tooltip contentStyle={{backgroundColor: 'var(--bg-panel)', border:'none', color:'var(--text-main)'}} /><Line type="monotone" dataKey="price" stroke="var(--primary)" strokeWidth={3} dot={{r: 4}} /></LineChart>
                </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
      {editingItem && (
        <div className="modal-backdrop" onClick={() => setEditingItem(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3>Edit</h3><button onClick={() => setEditingItem(null)}>×</button></div>
            <form onSubmit={handleUpdate} className="modal-body form-body">
                <div className="form-group"><label>Link</label><div className="input-group"><input value={editingItem.url} onChange={e => setEditingItem({...editingItem, url: e.target.value})} /><button type="button" onClick={() => copyToClipboard(editingItem.url)}>Copy</button></div></div>
                <div className="form-group"><label>Retention</label><select value={editingItem.retention_days} onChange={e => setEditingItem({...editingItem, retention_days: e.target.value})}><option value="30">30 Days</option><option value="365">1 Year</option></select></div>
                <button type="submit" className="save-btn">Save</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;