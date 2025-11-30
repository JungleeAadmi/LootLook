import { useState, useEffect, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Label } from 'recharts';
import io from 'socket.io-client';
import './index.css';

const API_URL = '/api';
let socket;

// --- ICONS ---
const Icons = {
  Menu: () => <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16m-7 6h7" /></svg>,
  Close: () => <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>,
  Sync: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
  Check: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
  Graph: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4v16a1 1 0 001 1h16M5 8l4-4 4 4" /></svg>,
  Snip: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
  Edit: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
  Web: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>,
  Visit: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>,
  Remove: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
  Copy: () => <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>,
  Export: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>,
  Logout: () => <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
};

function App() {
  const [token, setToken] = useState(localStorage.getItem('lootlook-token'));
  const [username, setUsername] = useState(localStorage.getItem('lootlook-user'));
  const [authMode, setAuthMode] = useState('login'); 
  const [authInput, setAuthInput] = useState({ username: '', password: '' });

  const [items, setItems] = useState([]);
  const [url, setUrl] = useState('');
  const [retention, setRetention] = useState(30);
  const [loading, setLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState(null);
  const [theme, setTheme] = useState(localStorage.getItem('lootlook-theme') || 'dark');
  const [filterDomain, setFilterDomain] = useState('ALL');
  const [selectedItem, setSelectedItem] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [viewImageItem, setViewImageItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [checkingAll, setCheckingAll] = useState(false); 
  const [globalSync, setGlobalSync] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { 
      document.body.className = theme;
      if (token) {
        socket = io({ auth: { token } }); 
        if (!socket.connected) socket.connect();
        fetchItems();
        socket.on('REFRESH_DATA', () => { fetchItems(); });
      }
      return () => { if(socket) socket.off('REFRESH_DATA'); };
  }, [theme, token]);

  const handleAuth = async (e) => {
      e.preventDefault();
      try {
          const endpoint = authMode === 'login' ? '/api/login' : '/api/register';
          const res = await fetch(endpoint, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(authInput)
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Auth failed');
          
          if (authMode === 'login') {
              localStorage.setItem('lootlook-token', data.token);
              localStorage.setItem('lootlook-user', data.username);
              setToken(data.token);
              setUsername(data.username);
          } else {
              alert('Registration successful! Please login.');
              setAuthMode('login');
          }
      } catch (err) { alert(err.message); }
  };

  const logout = () => {
      localStorage.removeItem('lootlook-token');
      localStorage.removeItem('lootlook-user');
      setToken(null); setItems([]); setMenuOpen(false);
  };

  const getDomain = (url) => { try { return new URL(url).hostname.replace('www.', ''); } catch (e) { return 'unknown'; } };
  const toggleTheme = () => { 
      const newTheme = theme === 'dark' ? 'colorful' : 'dark'; 
      setTheme(newTheme); localStorage.setItem('lootlook-theme', newTheme); 
      setMenuOpen(false);
  };
  
  const fetchItems = async () => { 
    if(!token) return;
    setGlobalSync(true); 
    try { 
        const res = await fetch(`${API_URL}/items`, { headers: { 'Authorization': `Bearer ${token}` } }); 
        if(res.status === 401 || res.status === 403) logout();
        const json = await res.json(); 
        setItems(json.data || []); 
    } catch (err) { console.error(err); } 
    setTimeout(() => setGlobalSync(false), 800); 
  };
  
  const handleAdd = async (e) => { e.preventDefault(); setLoading(true); try { const res = await fetch(`${API_URL}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ url, retention: parseInt(retention) }) }); if (!res.ok) throw new Error("Failed to add"); setUrl(''); } catch (err) { alert(err.message); } setLoading(false); };
  const handleDelete = async (id) => { if(!confirm("Delete?")) return; await fetch(`${API_URL}/items/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }); };
  const handleUpdate = async (e) => { e.preventDefault(); try { await fetch(`${API_URL}/items/${editingItem.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ url: editingItem.url, retention: parseInt(editingItem.retention_days) }) }); setEditingItem(null); } catch (err) { alert("Failed"); } };
  const handleRefresh = async (id) => { setRefreshingId(id); try { await fetch(`${API_URL}/refresh/${id}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }); } catch(err) { alert("Network error"); } setRefreshingId(null); };
  const handleCheckAll = async () => { setMenuOpen(false); if (checkingAll) return; if (!confirm(`Check all?`)) return; setCheckingAll(true); for (const item of items) { try { await fetch(`${API_URL}/refresh/${item.id}`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }); } catch (e) {} } setCheckingAll(false); };
  const handleExport = () => { setMenuOpen(false); window.open(`${API_URL}/export?token=${token}`, '_blank'); }; 

  const copyToClipboard = (text) => { navigator.clipboard.writeText(text).then(() => alert("Copied!")); };
  const openHistory = async (item) => { setSelectedItem(item); try { const res = await fetch(`${API_URL}/history/${item.id}`, { headers: { 'Authorization': `Bearer ${token}` } }); const json = await res.json(); setHistory(json.data.map(p => ({ date: new Date(p.date).toLocaleDateString(undefined, {month:'short', day:'numeric'}), price: p.price }))); } catch (err) { console.error(err); } };
  const openImage = (e, item) => { e.stopPropagation(); setViewImageItem(item); };

  const getTrend = (c, p) => (!p || c === p) ? 'neutral' : (c < p ? 'down' : 'up');
  const renderPriceBox = (item) => {
      const trend = getTrend(item.current_price, item.previous_price);
      const hasChange = item.previous_price > 0 && item.current_price !== item.previous_price;
      return ( <div className="price-box"><span className="currency">{item.currency}</span><span className="amount">{item.current_price.toLocaleString()}</span>{hasChange && (<span className={`prev-price ${trend}`}>{trend === 'down' ? 'Was' : 'Low'} {item.previous_price.toLocaleString()}</span>)}</div> );
  };

  const graphStats = useMemo(() => { if(history.length === 0) return { min: 0, max: 0 }; const prices = history.map(h => h.price); return { min: Math.min(...prices), max: Math.max(...prices) }; }, [history]);
  const domains = [...new Set(items.map(i => getDomain(i.url)))].sort((a, b) => a.localeCompare(b));
  const uniqueDomains = ['ALL', ...domains];
  const filteredItems = filterDomain === 'ALL' ? items : items.filter(i => getDomain(i.url) === filterDomain);
  const getImageSrc = (item) => { if (item.screenshot_path) return `${API_URL.replace('/api', '')}/screenshots/${item.screenshot_path}`; return item.image_url; };

  if (!token) {
      return (
        <div className={`app-wrapper ${theme} auth-screen`}>
            <button className="theme-float" onClick={toggleTheme}>{theme === 'dark' ? '☀️' : '🌙'}</button>
            <div className="auth-box">
                <div className="brand-center">
                    <div className="logo-box"><img src="/logo.svg" alt="Logo" className="logo-icon" /></div>
                    <h1>LootLook</h1>
                </div>
                <form onSubmit={handleAuth}>
                    <input className="main-input full-width" placeholder="Username" value={authInput.username} onChange={e => setAuthInput({...authInput, username: e.target.value})} required />
                    <input className="main-input full-width" placeholder="Password" type="password" value={authInput.password} onChange={e => setAuthInput({...authInput, password: e.target.value})} required />
                    <button type="submit" className="primary-btn full-width">{authMode === 'login' ? 'Login' : 'Sign Up'}</button>
                </form>
                <p className="auth-switch">{authMode === 'login' ? "New here?" : "Have account?"} <span onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? ' Join' : ' Login'}</span></p>
            </div>
        </div>
      );
  }

  return (
    <div className={`app-wrapper ${theme}`}>
      <nav className="navbar">
        <div className="nav-content">
            <div className="brand">
                <div className="logo-box"><img src="/logo.svg" alt="Logo" className="logo-icon" /></div>
                <span className="brand-name">LootLook</span>
            </div>
            <div className="nav-actions">
                {/* SYNC BUTTON (Always visible) */}
                <button className={`nav-btn ${globalSync ? 'spin' : ''}`} onClick={fetchItems} title="Sync">
                    <Icons.Sync />
                </button>

                {/* HAMBURGER MENU */}
                <button className="nav-btn" onClick={() => setMenuOpen(!menuOpen)}>
                    {menuOpen ? <Icons.Close /> : <Icons.Menu />}
                </button>

                {/* DROPDOWN */}
                {menuOpen && (
                    <div className="menu-dropdown">
                        <div className="menu-item" onClick={handleCheckAll}>⚡ Check All</div>
                        <div className="menu-item" onClick={handleExport}>📥 Export CSV</div>
                        <div className="menu-item" onClick={toggleTheme}>{theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}</div>
                        <div className="menu-item danger" style={{color: 'var(--danger)'}} onClick={logout}>Logout</div>
                    </div>
                )}
            </div>
        </div>
      </nav>

      <main className="main-content">
        <section className="controls-panel">
            <form onSubmit={handleAdd} className="add-bar">
                <input type="url" placeholder="Paste product link here..." value={url} onChange={(e) => setUrl(e.target.value)} required className="main-input" />
                <div className="add-actions">
                    <select value={retention} onChange={(e) => setRetention(e.target.value)} className="main-select"><option value="30">30 Days</option><option value="90">90 Days</option><option value="365">1 Year</option></select>
                    <button type="submit" disabled={loading} className="primary-btn">{loading ? 'Adding...' : 'Track'}</button>
                </div>
            </form>
            <div className="filter-bar"><label>Filter:</label><select onChange={(e) => setFilterDomain(e.target.value)} value={filterDomain} className="filter-select">{uniqueDomains.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
        </section>
        <section className="items-grid">
            {filteredItems.map(item => (
                <article key={item.id} className={`item-card trend-${getTrend(item.current_price, item.previous_price)}`}>
                    <div className="card-snip" onClick={(e) => openImage(e, item)}>
                        <div className="img-bg" style={{backgroundImage: `url(${getImageSrc(item)})`}}></div>
                        <span className="snip-tag">View Snip</span>
                    </div>
                    <div className="card-body" onClick={() => openHistory(item)}>
                        <h3 title={item.name}>{item.name}</h3>
                        <div className="meta-row">
                            {renderPriceBox(item)}
                            <span className="date-added">Added: {item.date_added ? new Date(item.date_added).toLocaleDateString(undefined, {day:'2-digit', month:'short'}) : 'N/A'}</span>
                        </div>
                        <div className="domain-row"><span className="badge">{getDomain(item.url)}</span></div>
                    </div>
                    <div className="card-actions">
                        <button onClick={() => handleRefresh(item.id)} disabled={refreshingId === item.id} className="action-btn check" title="Check Price">{refreshingId === item.id ? '...' : <Icons.Check />}</button>
                        <button onClick={() => openHistory(item)} className="action-btn graph" title="Price History"><Icons.Graph /></button>
                        <button onClick={(e) => openImage(e, item)} className="action-btn snip-btn" title="View Snip"><Icons.Snip /></button>
                        <button onClick={() => setEditingItem(item)} className="action-btn edit" title="Edit Item"><Icons.Edit /></button>
                        <a href={item.url} target="_blank" rel="noreferrer" className="action-btn visit" title="Webpage"><Icons.Web /></a>
                        <button onClick={() => handleDelete(item.id)} className="action-btn remove" title="Delete Item"><Icons.Remove /></button>
                    </div>
                </article>
            ))}
            {items.length === 0 && !loading && <div className="empty-state">No items yet. Add one above!</div>}
        </section>
      </main>
      {selectedItem && (<div className="modal-backdrop" onClick={() => setSelectedItem(null)}><div className="modal-box" onClick={e => e.stopPropagation()}><div className="modal-head"><h3>History</h3><button onClick={() => setSelectedItem(null)}>×</button></div><div className="modal-body graph-body"><ResponsiveContainer width="100%" height={300}><LineChart data={history} margin={{ top: 20, right: 20, bottom: 5, left: 0 }}><XAxis dataKey="date" stroke="currentColor" fontSize={12} /><YAxis stroke="currentColor" domain={['auto', 'auto']} /><Tooltip contentStyle={{backgroundColor: 'var(--bg-panel)', border:'none', color:'var(--text-main)'}} /><Line type="monotone" dataKey="price" stroke="var(--primary)" strokeWidth={3} dot={{r: 4, fill:'#38bdf8'}} activeDot={{r: 6}} /><ReferenceLine y={graphStats.min} stroke="var(--accent-green)" strokeDasharray="3 3"><Label value={`Min: ${graphStats.min}`} position="insideBottomRight" fill="var(--accent-green)" fontSize={10} /></ReferenceLine><ReferenceLine y={graphStats.max} stroke="var(--danger)" strokeDasharray="3 3"><Label value={`Max: ${graphStats.max}`} position="insideTopRight" fill="var(--danger)" fontSize={10} /></ReferenceLine></LineChart></ResponsiveContainer></div></div></div>)}
      {editingItem && (<div className="modal-backdrop" onClick={() => setEditingItem(null)}><div className="modal-box" onClick={e => e.stopPropagation()}><div className="modal-head"><h3>Edit</h3><button onClick={() => setEditingItem(null)}>×</button></div><form onSubmit={handleUpdate} className="modal-body form-body"><div className="form-group"><label>Link</label><div className="input-group"><input value={editingItem.url} onChange={e => setEditingItem({...editingItem, url: e.target.value})} /><button type="button" className="copy-btn" onClick={() => copyToClipboard(editingItem.url)} title="Copy Link"><Icons.Copy /></button></div></div><div className="form-group"><label>Retention</label><select value={editingItem.retention_days} onChange={e => setEditingItem({...editingItem, retention_days: e.target.value})}><option value="30">30 Days</option><option value="365">1 Year</option></select></div><button type="submit" className="save-btn">Save</button></form></div></div>)}
      {viewImageItem && (<div className="modal-backdrop" onClick={() => setViewImageItem(null)}><div className="modal-box image-modal" onClick={e => e.stopPropagation()}><div className="modal-head"><h3>Snip</h3><button onClick={() => setViewImageItem(null)}>×</button></div><div className="modal-body" style={{padding:0, display:'flex', justifyContent:'center', background:'#000'}}><img src={getImageSrc(viewImageItem)} alt="Snip" style={{maxWidth:'100%', maxHeight:'80vh', objectFit:'contain'}} /></div></div></div>)}
    </div>
  );
}

export default App;