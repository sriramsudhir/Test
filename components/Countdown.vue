<template>
  <h5>{{ formattedTime }}</h5>
</template>

<script>
  import moment from 'moment-timezone'
  export default {
    name: 'Countdown',
    data() {
      return {
        days: 0,
        date: moment(0),
        intervalHandler: null
      }
    },
    props: {
      endTime: {
        type: String,
        required: ''
      },
      timeZone: {
        type: String,
        default: ''
      },
    },
    computed: {
      formattedTime(){
        return Math.floor(this.days) + ':' +moment.utc(this.date).format('HH:mm:ss')
      }
    },
    mounted() {
      let now = moment()
      if(this.timeZone){
        now = moment(moment().tz(this.timeZone).format('Y-MM-DD H:mm:s'))
      }

      const then = moment(moment.utc(this.endTime)).local()

      this.date = then.diff(now, 'milliseconds')

      var duration = moment.duration(this.date, 'milliseconds');
      this.days = duration.asDays()

      this.intervalHandler = setInterval(() => {
        this.date = this.date - 1000
      }, 1000);
    },
    destroyed() {
      clearInterval(this.intervalHandler)
    }
  }
</script>
