<template>
  <li class="tree-node">
    <span class="node-data">

      <nuxt-link
        :to="categoryLink(node)"
        :title="node.title"
      >
        {{node.title}}
      </nuxt-link>
    </span>

    <ul>
    <footer-tree-node
      v-for="childNode in node.in_footer_child"
        :key="childNode.id"
        :node="childNode"
      />
    </ul>
  </li>
</template>

<script>
  import util from '~/mixin/util'

  export default {
    name: 'FooterTreeNode',
    components: {},
    props: {
      node: {
        type: Object,
        required: true,
      }
    },
    data() {
      return {
      };
    },
    mixins: [util],
    methods: {
    },
    computed: {
      nodeData(){
        return this.node[this.keyName]
      },
    }

  }
</script>
