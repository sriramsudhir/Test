export default {
  data() {
    return {
    }
  },
  methods: {
    goNext(current = null){
      if(current === $nuxt.$route.path){
        return
      }
      this.addLayer()
    },
    addLayer(){
      this.$nextTick(()=>{
        document.body.classList.add('going-next')
      })
    },
    loadedContent(){
      this.$nextTick(()=>{
        document.body.classList.remove('going-next')
      })
    }
  }
}
