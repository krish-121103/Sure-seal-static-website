/**
 * Store Locator - SureSeal Integration
 * Matches main website design system
 */

const CONFIG = {
    STORE_CSV_PATH: 'public/Customer Data for website - Data for website.csv',
    POSTCODE_API_URL: 'https://raw.githubusercontent.com/matthewproctor/australianpostcodes/master/australian_postcodes.csv',
    NOMINATIM_URL: 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=au&limit=1&q=',
    DEFAULT_CENTER: [-25.2744, 133.7751], // Center of Australia
    DEFAULT_ZOOM: 4
};

let storeLocatorState = {
    stores: [],
    postcodes: {},
    map: null,
    userMarker: null,
    storeMarkers: [],
    userCoords: null,
    routingControl: null
};

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
    // Only initialize if the element exists on the page
    if (document.getElementById('store-locator-map')) {
        initStoreLocatorMap();
        setupStoreLocatorListeners();
        await loadStoreData();
    }
});

function initStoreLocatorMap() {
    storeLocatorState.map = L.map('store-locator-map', {
        zoomControl: false,
        attributionControl: false
    }).setView(CONFIG.DEFAULT_CENTER, CONFIG.DEFAULT_ZOOM);
    
    L.control.zoom({ position: 'bottomright' }).addTo(storeLocatorState.map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(storeLocatorState.map);
}

function setupStoreLocatorListeners() {
    const useLocationBtn = document.getElementById('store-locator-use-location');
    const searchBtn = document.getElementById('store-locator-search-btn');
    const input = document.getElementById('store-locator-postcode-input');

    if (useLocationBtn) useLocationBtn.addEventListener('click', handleUseLocation);
    if (searchBtn) searchBtn.addEventListener('click', handleSearch);
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSearch();
        });
    }
}

// --- Data Loading ---

async function loadStoreData() {
    showStoreLocatorStatus('Loading store data...', 'info');
    
    try {
        const response = await fetch(CONFIG.STORE_CSV_PATH);
        if (!response.ok) throw new Error('Failed to load CSV');
        
        const csvText = await response.text();
        
        Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                storeLocatorState.stores = results.data.map(store => {
                    const cleanStore = {};
                    for (let key in store) {
                        cleanStore[key.trim()] = store[key] ? store[key].toString().trim() : '';
                    }
                    const latitude = parseFloat(cleanStore.Latitude || cleanStore.latitude || '');
                    const longitude = parseFloat(cleanStore.Longitude || cleanStore.longitude || '');
                    cleanStore.Latitude = Number.isFinite(latitude) ? latitude : null;
                    cleanStore.Longitude = Number.isFinite(longitude) ? longitude : null;
                    return cleanStore;
                });
                console.log('Stores loaded:', storeLocatorState.stores.length);
            }
        });

        // Load common postcodes for faster lookup
        const commonPostcodes = {
            '2000': { lat: -33.8688, lng: 151.2093 }, '3000': { lat: -37.8136, lng: 144.9631 },
            '4000': { lat: -27.4698, lng: 153.0251 }, '5000': { lat: -34.9285, lng: 138.6007 },
            '6000': { lat: -31.9505, lng: 115.8605 }, '2600': { lat: -35.2809, lng: 149.1300 },
            '7000': { lat: -42.8821, lng: 147.3272 }, '2164': { lat: -33.8475, lng: 150.9315 },
        };
        Object.assign(storeLocatorState.postcodes, commonPostcodes);

        showStoreLocatorStatus('Ready to find stores.', 'info', 2000);
    } catch (error) {
        console.error('Store locator data error:', error);
        showStoreLocatorStatus('Error loading data. Please try again later.', 'error');
    }
}

// --- Locating Logic ---

async function handleUseLocation() {
    if (!navigator.geolocation) {
        showStoreLocatorStatus('Geolocation is not supported by your browser.', 'error');
        return;
    }

    showStoreLocatorStatus('Detecting your location...', 'info');
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            const coords = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };
            storeLocatorState.userCoords = coords;
            findNearestStores(coords);
        },
        (error) => {
            console.error('Geolocation error:', error);
            showStoreLocatorStatus('Location access denied. Please enter postcode manually.', 'error');
        }
    );
}

async function handleSearch() {
    const input = document.getElementById('store-locator-postcode-input');
    const postcode = input.value.trim();
    if (!postcode) {
        showStoreLocatorStatus('Please enter a valid postcode.', 'error');
        return;
    }

    showStoreLocatorStatus(`Searching near ${postcode}...`, 'info');

    // Check cache
    if (storeLocatorState.postcodes[postcode]) {
        const coords = storeLocatorState.postcodes[postcode];
        storeLocatorState.userCoords = coords;
        findNearestStores(coords);
        return;
    }

    // Fallback to Geocoding
    try {
        const response = await fetch(CONFIG.NOMINATIM_URL + encodeURIComponent(postcode + ', Australia'));
        const data = await response.json();
        
        if (data && data.length > 0) {
            const coords = {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon)
            };
            storeLocatorState.postcodes[postcode] = coords; // Cache it
            storeLocatorState.userCoords = coords;
            findNearestStores(coords);
        } else {
            showStoreLocatorStatus('Postcode not found.', 'error');
        }
    } catch (error) {
        console.error('Geocoding error:', error);
        showStoreLocatorStatus('Error finding postcode.', 'error');
    }
}

// --- Distance & Results ---

function findNearestStores(userCoords) {
    const results = storeLocatorState.stores.map(store => {
        const hasStoreCoords =
            Number.isFinite(store.Latitude) &&
            Number.isFinite(store.Longitude);

        const storeCoords = hasStoreCoords
            ? { lat: store.Latitude, lng: store.Longitude }
            : null;
        
        let distance = Infinity;
        if (storeCoords) {
            distance = calculateHaversine(
                userCoords.lat, userCoords.lng,
                storeCoords.lat, storeCoords.lng
            );
        }

        return { ...store, distance, coords: storeCoords };
    });

    const nearest = results
        .filter(s => s.distance !== Infinity)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);

    displayStoreResults(nearest, userCoords);
}

function calculateHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// --- UI Rendering ---

function displayStoreResults(stores, userCoords) {
    const list = document.getElementById('store-locator-results-list');
    const count = document.getElementById('store-locator-results-count');
    list.innerHTML = '';

    if (stores.length === 0) {
        list.innerHTML = '<div class="store-locator-empty">No stores found near this location.</div>';
        count.textContent = '0 results';
        showStoreLocatorStatus('No stores found in this area.', 'error');
        return;
    }

    count.textContent = `Showing top ${stores.length} nearest stores`;
    showStoreLocatorStatus('Found nearest stores!', 'success', 3000);

    stores.forEach((store) => {
        const locationLabel = `${store.ResolvedCity || store.City}, ${store.State} ${store.ResolvedPostCode || store.PostCode}`.trim();
        const card = document.createElement('div');
        card.className = 'store-locator-card';
        card.innerHTML = `
            <div class="store-locator-distance">${store.distance.toFixed(1)} km</div>
            <h4 class="alt-font">${store.Customer}</h4>
            <p>
                <i class="feather icon-feather-map-pin"></i>
                ${locationLabel}
            </p>
            <div class="store-locator-card-footer">
                <span>Click for Navigation Path</span>
            </div>
        `;
        
        card.addEventListener('click', () => {
            if (store.coords) {
                document.querySelectorAll('.store-locator-card').forEach(c => c.classList.remove('active'));
                card.classList.add('active');
                calculateStoreRoute(store.coords);
            }
        });

        list.appendChild(card);
    });

    updateStoreLocatorMap(stores, userCoords);
}

function calculateStoreRoute(targetCoords) {
    if (!storeLocatorState.userCoords) return;

    if (storeLocatorState.routingControl) {
        storeLocatorState.map.removeControl(storeLocatorState.routingControl);
    }

    storeLocatorState.routingControl = L.Routing.control({
        waypoints: [
            L.latLng(storeLocatorState.userCoords.lat, storeLocatorState.userCoords.lng),
            L.latLng(targetCoords.lat, targetCoords.lng)
        ],
        lineOptions: {
            styles: [{ color: '#006eb7', weight: 6, opacity: 0.8 }]
        },
        createMarker: function() { return null; },
        routeWhileDragging: false,
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: true,
        showAlternatives: false,
        collapsible: true
    }).addTo(storeLocatorState.map);
}

function updateStoreLocatorMap(stores, userCoords) {
    if (storeLocatorState.routingControl) {
        storeLocatorState.map.removeControl(storeLocatorState.routingControl);
        storeLocatorState.routingControl = null;
    }

    if (storeLocatorState.userMarker) storeLocatorState.map.removeLayer(storeLocatorState.userMarker);
    storeLocatorState.storeMarkers.forEach(m => storeLocatorState.map.removeLayer(m));
    storeLocatorState.storeMarkers = [];

    storeLocatorState.userMarker = L.marker([userCoords.lat, userCoords.lng], {
        icon: L.icon({
            iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowSize: [41, 41]
        })
    }).addTo(storeLocatorState.map).bindPopup('<b>Your Location</b>');

    const group = L.featureGroup([storeLocatorState.userMarker]);
    
    stores.forEach(store => {
        if (store.coords) {
            const marker = L.marker([store.coords.lat, store.coords.lng])
                .addTo(storeLocatorState.map)
                .bindPopup(`<b>${store.Customer}</b><br>${store.ResolvedCity || store.City}`);
            
            storeLocatorState.storeMarkers.push(marker);
            group.addLayer(marker);
        }
    });

    storeLocatorState.map.fitBounds(group.getBounds().pad(0.1));
}

function showStoreLocatorStatus(text, type, duration = 0) {
    const el = document.getElementById('store-locator-status');
    if (!el) return;
    el.textContent = text;
    el.className = `store-locator-status ${type}`;
    el.classList.remove('hidden');
    
    if (duration > 0) {
        setTimeout(() => {
            if (el.textContent === text) el.classList.add('hidden');
        }, duration);
    }
}
