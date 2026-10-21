// Assumptions, not a vendor quote. Decimal GB. No credentials/network access.
const students=385,hours=120,bytesPerActiveMinute=Number(process.env.BYTES_PER_ACTIVE_MINUTE??500000);
// Conservatively allow two billed relay egress legs and 30% transport overhead.
const relayMultiplier=2.6,freeTurnGB=1000,turnPricePerGB=.05;
const rows=[];
for(const duty of [.1,.25,1])for(const relay of [0,.25,1]){
 const boardGB=students*hours*60*duty*bytesPerActiveMinute/1e9;
 const turnGB=boardGB*relay*relayMultiplier;
 rows.push({dutyPercent:duty*100,relayPercent:relay*100,applicationGB:+boardGB.toFixed(2),turnGB:+turnGB.toFixed(2),turnUSD:+(Math.max(0,turnGB-freeTurnGB)*turnPricePerGB).toFixed(2)});
}
console.log(JSON.stringify({assumptions:{students,teachers:15,hoursAtDeploymentScale:hours,aggregateClassroomHours:hours*15,bytesPerActiveMinute,relayMultiplier,freeTurnGB,turnPricePerGB,otherRealtimeUsageGB:0},rows},null,2));
