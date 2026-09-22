/**
 * OmniTRAF Surabaya - Geospatial Coordinates & GeoJSON Standard Config
 * Menyiapkan struktur data geospasial berstandar GeoJSON (FeatureCollection, LineString, Polygon, Point)
 * untuk Koridor Utama, Sinyal APILL, CCTV, Insiden, Distrik, dan Rute Tanggap Darurat 112 Surabaya.
 */

export const SURABAYA_CENTER = {
  lat: -7.2756,
  lng: 112.7424,
  zoom: 13
};

/**
 * 1. SIMPANG APILL ATCS SITS SURABAYA (GeoJSON FeatureCollection Point)
 */
export const SITS_INTERSECTIONS_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7345, -7.2985] // [lng, lat]
      },
      properties: {
        id: "node-wonokromo",
        name: "Simpang Wonokromo (DTC)",
        corridor: "Darmo - A. Yani",
        district: "Surabaya Selatan",
        defaultGreen: 35,
        currentWait: 42,
        saturationFlow: 1800,
        hasCamera: true,
        cameraFeed: "CAM-WONOKROMO-02",
        tags: ["critical", "green-wave-route", "emergency-priority"],
        status: "danger",
        color: "#ef4444"
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7375, -7.2625]
      },
      properties: {
        id: "node-tunjungan",
        name: "Simpang Tunjungan / Siola",
        corridor: "Tunjungan - Pemuda",
        district: "Surabaya Pusat",
        defaultGreen: 45,
        currentWait: 18,
        saturationFlow: 2200,
        hasCamera: true,
        cameraFeed: "CAM-SIOLA-01",
        tags: ["cultural-center", "smart-pavement"],
        status: "success",
        color: "#22c55e"
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7565, -7.2710]
      },
      properties: {
        id: "node-kertajaya",
        name: "Simpang Kertajaya - Dharmawangsa",
        corridor: "Kertajaya Arteri",
        district: "Surabaya Timur",
        defaultGreen: 30,
        currentWait: 28,
        saturationFlow: 1650,
        hasCamera: true,
        cameraFeed: "CAM-KERTAJAYA-03",
        tags: ["hospital-route", "university-access"],
        status: "warning",
        color: "#f59e0b"
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7395, -7.2810]
      },
      properties: {
        id: "node-darmo",
        name: "Simpang Raya Darmo - Polrestabes",
        corridor: "Darmo - A. Yani",
        district: "Surabaya Pusat",
        defaultGreen: 40,
        currentWait: 25,
        saturationFlow: 2100,
        hasCamera: true,
        cameraFeed: "CAM-DARMO-01",
        tags: ["green-wave-route", "emergency-priority"],
        status: "warning",
        color: "#f59e0b"
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7315, -7.3180]
      },
      properties: {
        id: "node-jemursari",
        name: "Simpang A. Yani - Jemursari",
        corridor: "Darmo - A. Yani",
        district: "Surabaya Selatan",
        defaultGreen: 32,
        currentWait: 58,
        saturationFlow: 1950,
        hasCamera: true,
        cameraFeed: "CAM-JEMURSARI-01",
        tags: ["critical", "industrial-spur"],
        status: "danger",
        color: "#ef4444"
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7160, -7.2895]
      },
      properties: {
        id: "node-sungkono",
        name: "Simpang Mayjen Sungkono - TVRI",
        corridor: "Mayjen Sungkono Arteri",
        district: "Surabaya Barat",
        defaultGreen: 28,
        currentWait: 34,
        saturationFlow: 1500,
        hasCamera: true,
        cameraFeed: "CAM-SUNGKONO-02",
        tags: ["toll-access", "commercial-hub"],
        status: "warning",
        color: "#f59e0b"
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7815, -7.2740]
      },
      properties: {
        id: "node-merr",
        name: "Simpang MERR - Kertajaya Indah",
        corridor: "MERR Dr. Ir. H. Soekarno",
        district: "Surabaya Timur",
        defaultGreen: 50,
        currentWait: 15,
        saturationFlow: 2400,
        hasCamera: true,
        cameraFeed: "CAM-MERR-04",
        tags: ["ring-road", "high-speed-artery"],
        status: "success",
        color: "#22c55e"
      }
    }
  ]
};

/**
 * 2. KORIDOR UTAMA JALAN ARTERI SURABAYA (GeoJSON FeatureCollection LineString)
 */
export const SURABAYA_CORRIDORS_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [112.7300, -7.3450], // Waru / Bundaran DOLOG
          [112.7315, -7.3320], // Margorejo
          [112.7330, -7.3180], // Jemursari
          [112.7345, -7.2985], // Wonokromo
          [112.7370, -7.2920], // Marmoyo
          [112.7395, -7.2810]  // Taman Bungkul
        ]
      },
      properties: {
        id: "corridor-darmo-yani",
        name: "Jl. Ahmad Yani - Raya Darmo (Koridor Utama SITS)",
        status: "Padat Rayap / Macet (14 km/jam)",
        speed: 14,
        color: "#ef4444",
        weight: 6,
        isEmergencyCorridor: true
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [112.7395, -7.2810], // Taman Bungkul
          [112.7385, -7.2720], // Urip Sumoharjo
          [112.7380, -7.2670], // Basuki Rahmat
          [112.7375, -7.2625]  // Tunjungan
        ]
      },
      properties: {
        id: "corridor-basuki-tunjungan",
        name: "Jl. Basuki Rahmat - Tunjungan",
        status: "Lancar (38 km/jam)",
        speed: 38,
        color: "#3b82f6",
        weight: 5
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [112.7210, -7.2610], // Pasar Turi
          [112.7375, -7.2625], // Siola
          [112.7480, -7.2635], // Pemuda / Gubernur Suryo
          [112.7635, -7.2645]  // Gubeng
        ]
      },
      properties: {
        id: "corridor-pemuda",
        name: "Jl. Tunjungan - Pemuda - Embong Malang",
        status: "Ramai Lancar (29 km/jam)",
        speed: 29,
        color: "#3b82f6",
        weight: 5
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [112.7565, -7.2710], // Dharmawangsa
          [112.7690, -7.2725], // Menur
          [112.7815, -7.2740]  // MERR Kertajaya
        ]
      },
      properties: {
        id: "corridor-kertajaya",
        name: "Jl. Kertajaya - Manyar",
        status: "Sangat Lancar (45 km/jam)",
        speed: 45,
        color: "#22c55e",
        weight: 5
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [112.7345, -7.2985], // Wonokromo
          [112.7160, -7.2895], // TVRI / Mayjen Sungkono
          [112.6970, -7.2875]  // Adityawarman / Ciputra World
        ]
      },
      properties: {
        id: "corridor-sungkono",
        name: "Jl. Mayjen Sungkono - Adityawarman",
        status: "Padat Merayap (18 km/jam)",
        speed: 18,
        color: "#f59e0b",
        weight: 5
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [112.7800, -7.2350], // MERR Kenjeran
          [112.7815, -7.2740], // MERR Kertajaya
          [112.7830, -7.3150], // MERR Pandugo
          [112.7845, -7.3400]  // MERR Gunung Anyar
        ]
      },
      properties: {
        id: "corridor-merr",
        name: "MERR Dr. Ir. H. Soekarno (Middle East Ring Road)",
        status: "Sangat Lancar (52 km/jam)",
        speed: 52,
        color: "#22c55e",
        weight: 6
      }
    }
  ]
};

/**
 * 3. JALAN SEKUNDER & KOLEKTOR (GeoJSON FeatureCollection LineString)
 */
export const MINOR_ROADS_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [112.7345, -7.2985], // Wonokromo
          [112.7240, -7.2850], // Diponegoro
          [112.7180, -7.2710]  // Pasar Kembang
        ]
      },
      properties: { name: "Jl. Diponegoro - Pasar Kembang", color: "#f59e0b" }
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [112.6970, -7.2875], // Mayjen Sungkono
          [112.6820, -7.2855], // HR Muhammad
          [112.6680, -7.2835]  // Bukit Darmo
        ]
      },
      properties: { name: "Jl. HR Muhammad / Bukit Darmo", color: "#3b82f6" }
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [112.7210, -7.2610], // Pasar Turi
          [112.7260, -7.2380], // Krembangan
          [112.7320, -7.2050]  // Pelabuhan Tg. Perak
        ]
      },
      properties: { name: "Akses Tol Dupak - Pelabuhan Tg. Perak", color: "#22c55e" }
    }
  ]
};

/**
 * 4. SUNGAI KALIMAS SURABAYA (GeoJSON Feature LineString)
 */
export const KALIMAS_RIVER_GEOJSON = {
  type: "Feature",
  geometry: {
    type: "LineString",
    coordinates: [
      [112.7410, -7.2350], // Perak Utara
      [112.7400, -7.2480], // Jembatan Merah
      [112.7390, -7.2610], // Ketabang / Monkasel
      [112.7405, -7.2750], // Gubeng
      [112.7420, -7.2920], // Ngagel
      [112.7435, -7.3100], // Jagir Wonokromo
      [112.7450, -7.3320]  // Panjang Jiwo
    ]
  },
  properties: {
    name: "Aliran Sungai Kalimas Surabaya",
    color: "#0284c7"
  }
};

/**
 * 5. ZONA DISTRIK & WILAYAH KOTA (GeoJSON FeatureCollection Polygon)
 */
export const SURABAYA_DISTRICTS_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [112.7250, -7.2450],
          [112.7550, -7.2450],
          [112.7550, -7.2800],
          [112.7250, -7.2800],
          [112.7250, -7.2450]
        ]]
      },
      properties: { name: "Surabaya Pusat", color: "#38bdf8" }
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [112.7150, -7.2800],
          [112.7500, -7.2800],
          [112.7500, -7.3450],
          [112.7150, -7.3450],
          [112.7150, -7.2800]
        ]]
      },
      properties: { name: "Surabaya Selatan", color: "#f43f5e" }
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [112.7550, -7.2450],
          [112.7950, -7.2450],
          [112.7950, -7.3100],
          [112.7550, -7.3100],
          [112.7550, -7.2450]
        ]]
      },
      properties: { name: "Surabaya Timur", color: "#10b981" }
    },
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [112.6500, -7.2500],
          [112.7150, -7.2500],
          [112.7150, -7.3100],
          [112.6500, -7.3100],
          [112.6500, -7.2500]
        ]]
      },
      properties: { name: "Surabaya Barat", color: "#fbbf24" }
    }
  ]
};

/**
 * 6. INSIDEN LALU LINTAS & HAMBATAN JALAN (GeoJSON FeatureCollection Point)
 */
export const SURABAYA_INCIDENTS_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7180, -7.2710]
      },
      properties: {
        id: "inc-kupang",
        name: "Simpang Kupang / Pasar Kembang",
        severity: "danger",
        jenis: "Penyempitan Jalan Akibat Truk Mogok",
        est: "± 20 Menit (Derek On-Site)",
        petugas: "Bripka Rahmat (Satlantas) & Tim SITS"
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7690, -7.2725]
      },
      properties: {
        id: "inc-manyar",
        name: "Koridor Manyar Kertoarjo",
        severity: "warning",
        jenis: "Antrean Imbas Genangan Air Hujan (15 cm)",
        est: "± 10 Menit (Pompa Aktif)",
        petugas: "Petugas BPBD Surabaya"
      }
    }
  ]
};

/**
 * 7. LANDMARK IKONIK SURABAYA (GeoJSON FeatureCollection Point)
 */
export const SURABAYA_LANDMARKS_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7635, -7.2690]
      },
      properties: { name: "RSUD Dr. Soetomo Surabaya" }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7380, -7.2610]
      },
      properties: { name: "Tunjungan Plaza Mall" }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7345, -7.2985]
      },
      properties: { name: "Flyover Wonokromo (DTC)" }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7320, -7.2050]
      },
      properties: { name: "Pelabuhan Tanjung Perak" }
    }
  ]
};

/**
 * 8. JARINGAN CCTV SITS SURABAYA (GeoJSON FeatureCollection Point)
 */
export const SITS_CCTV_CAMERAS_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7315, -7.3320]
      },
      properties: {
        id: "cam-ayani",
        name: "CCTV A. Yani (Margorejo)",
        status: "Padat Merayap",
        statusClass: "badge-danger",
        ruas: "Selatan ke Utara (Lajur Utama)",
        speed: "12 km/jam"
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7395, -7.2810]
      },
      properties: {
        id: "cam-darmo",
        name: "CCTV Raya Darmo (Taman Bungkul)",
        status: "Ramai Lancar",
        statusClass: "badge-warning",
        ruas: "Dua Arah (Utara - Selatan)",
        speed: "34 km/jam"
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7375, -7.2625]
      },
      properties: {
        id: "cam-tunjungan",
        name: "CCTV Tunjungan (Siola)",
        status: "Sangat Lancar",
        statusClass: "badge-success",
        ruas: "Satu Arah (Selatan ke Utara)",
        speed: "42 km/jam"
      }
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [112.7160, -7.2895]
      },
      properties: {
        id: "cam-sungkono",
        name: "CCTV Mayjen Sungkono",
        status: "Padat Merayap",
        statusClass: "badge-warning",
        ruas: "Barat ke Timur (Akses Tol)",
        speed: "19 km/jam"
      }
    }
  ]
};

/**
 * 9. RUTE PRIORITAS TANGGAP DARURAT 112 (GeoJSON LineString)
 */
export const EMERGENCY_PATHS_GEOJSON = {
  ambulance: {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [112.7300, -7.3450], // DOLOG
        [112.7315, -7.3320], // Margorejo
        [112.7330, -7.3180], // Jemursari
        [112.7345, -7.2985], // Wonokromo
        [112.7370, -7.2920], // Marmoyo
        [112.7395, -7.2810], // Bungkul
        [112.7480, -7.2720], // Ngagel
        [112.7635, -7.2690]  // RSU Dr. Soetomo
      ]
    },
    properties: {
      id: "ambulance-02",
      name: "Ambulans 02 RSU Dr. Soetomo",
      speedText: "62 km/jam"
    }
  },
  fire: {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: [
        [112.7160, -7.2895], // TVRI Sungkono
        [112.6970, -7.2875], // Ciputra World
        [112.6820, -7.2855], // HR Muhammad
        [112.6970, -7.2875]  // Turnaround loop
      ]
    },
    properties: {
      id: "fire-04",
      name: "Pemadam 04 Kota Surabaya",
      speedText: "55 km/jam"
    }
  }
};

/**
 * HELPER ARRAY CONVERTERS FOR BACKWARD COMPATIBILITY
 */
export const SURABAYA_CORRIDORS = SURABAYA_CORRIDORS_GEOJSON.features.map(f => ({
  id: f.properties.id,
  name: f.properties.name,
  status: f.properties.status,
  color: f.properties.color,
  weight: f.properties.weight,
  coords: f.geometry.coordinates.map(pt => [pt[1], pt[0]]) // [lat, lng]
}));

export const MINOR_ROADS = MINOR_ROADS_GEOJSON.features.map(f => ({
  name: f.properties.name,
  color: f.properties.color,
  coords: f.geometry.coordinates.map(pt => [pt[1], pt[0]])
}));

export const KALIMAS_RIVER = KALIMAS_RIVER_GEOJSON.geometry.coordinates.map(pt => [pt[1], pt[0]]);

export const SURABAYA_DISTRICTS = SURABAYA_DISTRICTS_GEOJSON.features.map(f => ({
  name: f.properties.name,
  color: f.properties.color,
  coords: f.geometry.coordinates[0].map(pt => [pt[1], pt[0]])
}));

export const SURABAYA_INCIDENTS = SURABAYA_INCIDENTS_GEOJSON.features.map(f => ({
  id: f.properties.id,
  name: f.properties.name,
  jenis: f.properties.jenis,
  est: f.properties.est,
  petugas: f.properties.petugas,
  lat: f.geometry.coordinates[1],
  lng: f.geometry.coordinates[0]
}));

export const SURABAYA_LANDMARKS = SURABAYA_LANDMARKS_GEOJSON.features.map(f => ({
  name: f.properties.name,
  lat: f.geometry.coordinates[1],
  lng: f.geometry.coordinates[0]
}));

export const SITS_CCTV_CAMERAS = SITS_CCTV_CAMERAS_GEOJSON.features.map(f => ({
  id: f.properties.id,
  name: f.properties.name,
  status: f.properties.status,
  statusClass: f.properties.statusClass,
  ruas: f.properties.ruas,
  speed: f.properties.speed,
  lat: f.geometry.coordinates[1],
  lng: f.geometry.coordinates[0]
}));

export const SITS_INTERSECTIONS = SITS_INTERSECTIONS_GEOJSON.features.map(f => ({
  id: f.properties.id,
  name: f.properties.name,
  corridor: f.properties.corridor,
  district: f.properties.district,
  defaultGreen: f.properties.defaultGreen,
  currentWait: f.properties.currentWait,
  saturationFlow: f.properties.saturationFlow,
  hasCamera: f.properties.hasCamera,
  cameraFeed: f.properties.cameraFeed,
  tags: f.properties.tags,
  status: f.properties.status,
  color: f.properties.color,
  lat: f.geometry.coordinates[1],
  lng: f.geometry.coordinates[0]
}));

export const EMERGENCY_PATHS = {
  ambulance: EMERGENCY_PATHS_GEOJSON.ambulance.geometry.coordinates.map(pt => [pt[1], pt[0]]),
  fire: EMERGENCY_PATHS_GEOJSON.fire.geometry.coordinates.map(pt => [pt[1], pt[0]])
};
