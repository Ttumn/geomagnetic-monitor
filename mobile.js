async function fetchKSA() {
    const now = new Date();
    for (let i = 0; i < 3; i++) {
        const date = new Date(now.getTime() - i * 24*60*60*1000);
        const year = date.getUTCFullYear();
        const dateStr = date.toISOString().split('T')[0];
        const url = `https://embracedata.inpe.br/ksa/${year}/${dateStr}.txt`;
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const text = await res.text();
            const lines = text.trim().split('\n');
            const labels = [];
            const values = [];
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const time = new Date(parts[0]);
                    labels.push(`${time.getUTCHours()}h`);
                    const val = parseFloat(parts[1]);
                    if (!isNaN(val)) values.push(val);
                }
            }
            if (values.length) return {labels, values};
        } catch(e) {
            console.error('KSA fetch error', e);
        }
    }
    return {labels:[], values:[]};
}

async function fetchKP() {
    const url = 'https://services.swpc.noaa.gov/text/3-day-geomag-forecast.txt';
    const res = await fetch(url);
    const text = await res.text();
    const lines = text.split('\n');
    const pattern = /(\d{2}-\d{2})UT/;
    let start = -1;
    for (let i=0;i<lines.length;i++) {
        if (pattern.test(lines[i]) && lines[i].includes('00-03UT')) { start=i; break; }
    }
    if (start===-1) return {labels:[], values:[]};
    const labels=[];
    const values=[];
    for (let j=0;j<8;j++) {
        const line = lines[start+j] || '';
        const nums = line.match(/\b(\d+\.?\d*)\b/g);
        if (nums && nums[1]) {
            const val = parseFloat(nums[1]);
            values.push(val);
            const hrs = line.slice(0,5).replace(/UT|\s/g,'');
            labels.push(hrs);
        }
    }
    return {labels, values};
}

async function fetchHP30() {
    const end = new Date();
    const start = new Date(end.getTime()-24*60*60*1000);
    const startStr = start.toISOString().slice(0,19)+'Z';
    const endStr = end.toISOString().slice(0,19)+'Z';
    const url = `https://kp.gfz.de/app/json/?start=${startStr}&end=${endStr}&index=Hp30`;
    const res = await fetch(url);
    const data = await res.json();
    const labels = data.datetime.map(t => {
        const d = new Date(t);
        return `${d.getUTCHours()}:${('0'+d.getUTCMinutes()).slice(-2)}`;
    });
    return {labels, values: data.Hp30 || []};
}

function createChart(ctx, label, data){
    return new Chart(ctx, {
        type:'line',
        data:{ labels:data.labels, datasets:[{ label, data:data.values, borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.3)', fill:true }] },
        options:{ scales:{ x:{ ticks:{ color:'#f1f5f9'} }, y:{ ticks:{ color:'#f1f5f9'} } }, plugins:{ legend:{ labels:{ color:'#f1f5f9' } } } }
    });
}

async function init(){
    const ksa = await fetchKSA();
    createChart(document.getElementById('ksaChart').getContext('2d'),'KSA', ksa);
    const kp = await fetchKP();
    createChart(document.getElementById('kpChart').getContext('2d'),'Kp NOAA', kp);
    const hp = await fetchHP30();
    createChart(document.getElementById('hpChart').getContext('2d'),'HP30', hp);
}

document.addEventListener('DOMContentLoaded', init);
