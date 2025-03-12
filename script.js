function calculateStandardError(values) {
    if (!values || values.length === 0) {
        return { mean: 0, stdError: 0 };
    }
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredSum = values.reduce((sum, val) => sum + (val - mean) ** 2, 0);
    const variance = squaredSum / values.length;
    const stdDev = Math.sqrt(variance);
    const stdError = stdDev / Math.sqrt(values.length);
    return { mean, stdError };
}

function idwInterpolation(nearbyStations, data, power) {
    let numerator = 0;
    let denominator = 0;

    for (const stationId in nearbyStations) {
        const distance = nearbyStations[stationId][7];
        if (data[stationId] !== undefined) {
            if (distance === 0) {
                return data[stationId].Precipitation;
            }
            const weight = 1 / (distance ** power);
            numerator += weight * data[stationId].Precipitation;
            denominator += weight;
        }
    }

    return denominator === 0 ? 0 : numerator / denominator;
}

function determineRank(value, colorBar) {
    for (let i = 0; i < colorBar.length; i++) {
        if (value < colorBar[i][3]) {
            return i;
        }
    }
    return colorBar.length - 1;
}

async function fetchRainfallData() {
    const url = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0002-001?Authorization=rdec-key-123-45678-011121314&format=JSON';
    try {
        const response = await fetch(url);
        const data = await response.json();

        if (!data.success) {
          console.error("Failed to fetch rainfall data:", data.msg);
          return {};
        }
        const records = data.records.Station;
        const rainfallData = {};

        records.forEach(record => {
            const stationId = record.StationId;
            const obstime = record.ObsTime.DateTime;
            const precipitation = parseFloat(record.Rainfall.Now.Precipitation);

            rainfallData[stationId] = {
                obstime: obstime,
                Precipitation: isNaN(precipitation) ? 0 : precipitation,
            };
        });
        return rainfallData;
    } catch (error) {
        console.error('Error fetching rainfall data:', error);
        return {};
    }
}

async function fetchNearbyStations() {
    try {
        const response = await fetch('nearby_stations.json');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching nearby stations data:', error);
        return {};
    }
}

async function processRainfallData() {
    const power = 2; // IDW power parameter
    const seThreshold = 6; // Standard error threshold
    const rankDifference = 2; // acceptable rank diff
    const valueDifference = 25; // acceptable value diff

    const colorBar = [
        [245, 245, 245, 0.1],
        [193, 193, 193, 1],
        [153, 255, 255, 2],
        [0, 204, 255, 6],
        [0, 153, 255, 10],
        [0, 102, 255, 15],
        [51, 153, 0, 20],
        [51, 255, 0, 30],
        [255, 255, 0, 40],
        [255, 204, 0, 50],
        [255, 153, 0, 70],
        [255, 0, 0, 90],
        [204, 0, 0, 110],
        [153, 0, 0, 130],
        [153, 0, 153, 150],
        [204, 0, 204, 200],
        [255, 0, 255, 300]
    ];

    const rainfallData = await fetchRainfallData();
    const nearbyStationsData = await fetchNearbyStations();
    const tableBody = document.querySelector('#rainfallTable tbody');
    tableBody.innerHTML = '';

    const allTableRows = [];

    for (const stationId in nearbyStationsData) {
      if (rainfallData[stationId] !== undefined) { //check data exist
        const station = nearbyStationsData[stationId];
        const observedValue = rainfallData[stationId].Precipitation;
        const nearbyStations = station.nearby_stations_info;
        const obstime = rainfallData[stationId].obstime;


        if (Object.keys(nearbyStations).length > 0) {
            const idwValue = idwInterpolation(nearbyStations, rainfallData, power);
            const observedRank = determineRank(observedValue, colorBar);
            const idwRank = determineRank(idwValue, colorBar);

            const nearbyRainfalls = Object.keys(nearbyStations)
                .filter(nearbyId => rainfallData[nearbyId]!==undefined)
                .map(nearbyId => rainfallData[nearbyId].Precipitation);

            const { mean, stdError } = calculateStandardError(nearbyRainfalls);

            if (Math.abs(observedValue - mean) > seThreshold * stdError &&
                (Math.abs(observedRank - idwRank) > rankDifference && Math.abs(idwValue - observedValue) >= valueDifference)) {

                const nearbyStationsInfo = Object.keys(nearbyStations).map(nearbyId => {
                    const nearbyStation = nearbyStations[nearbyId];
                    const rainfall = rainfallData[nearbyId] ? rainfallData[nearbyId].Precipitation.toFixed(2) : 'N/A';
                    const department = nearbyStation[6] || 'N/A';
                    const cname = nearbyStation[0] || 'N/A';
                    const distance = nearbyStation[7] ? nearbyStation[7].toFixed(2) : 'N/A';
                    const alt = nearbyStation[3] ? nearbyStation[3].toFixed(1) : 'N/A'; // Format altitude
                    return `${department}-${cname}-${nearbyId} (${rainfall} mm, ${distance} km, ${alt} m)`;
                }).join(', ');


                const rowData = {
                    obstime: obstime,
                    stationId: stationId,
                    stationName: station.CName,
                    altitude: station.Alt, // Use Alt directly from nearby_stations.json
                    observedValue: observedValue.toFixed(2),
                    observedRank: observedRank,
                    idwValue: idwValue.toFixed(2),
                    idwRank: idwRank,
                    meanRainfall: mean.toFixed(2),
                    stdError: stdError.toFixed(2),
                    nearbyStations: nearbyStationsInfo
                };

                allTableRows.push(rowData);


            }
          }
        }
    }

    allTableRows.sort((a, b) => new Date(a.obstime) - new Date(b.obstime));

    allTableRows.forEach(rowData => {

        const row = document.createElement('tr');
        if (Math.abs(rowData.observedValue - rowData.meanRainfall) > seThreshold * rowData.stdError &&
            (Math.abs(rowData.observedRank - rowData.idwRank) > 2 && Math.abs(rowData.idwValue - rowData.observedValue) >= 25)) {
            row.classList.add('highlight');
        }
        row.innerHTML = `
            <td>${rowData.obstime}</td>
            <td>${rowData.stationId}</td>
            <td>${rowData.stationName}</td>
            <td>${rowData.altitude}</td>
            <td>${rowData.observedValue}</td>
            <td>${rowData.observedRank}</td>
            <td>${rowData.idwValue}</td>
            <td>${rowData.idwRank}</td>
            <td>${rowData.meanRainfall}</td>
            <td>${rowData.stdError}</td>
            <td>${rowData.nearbyStations}</td>
        `;
      tableBody.appendChild(row);
    });

    // Initialize DataTables after populating the table
    $(document).ready(function () {
        $('#rainfallTable').DataTable({
          "order": [[ 0, "desc" ]],  //order by time
          "columns": [
            { "width": "8%" },
            { "width": "8%" },
            { "width": "8%" },
            { "width": "8%" },
            { "width": "8%" },
            { "width": "8%" },
            { "width": "8%" },
            { "width": "8%" },
            { "width": "8%" },
            { "width": "8%" },
            { "width": "20%" }  
        ]
        });
    });
}

processRainfallData();
